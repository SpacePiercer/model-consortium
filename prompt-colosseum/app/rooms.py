"""
Rooms: one match between two players, as a state machine.

No Flask or Socket.IO in here. events.py wires it to the sockets, and the tests drive it with a
recording `emit` and a manual clock. Phases:

    lobby -> countdown -> writing -> judging -> verdict -> (writing | finished)

Every public method takes the room lock. Timers and the judge thread call back in through the
same lock, and a timer that fires after its phase has moved on sees a newer `epoch` and does
nothing. The server is the source of truth for scores, damage, HP, the timer and the context bar.
"""
import functools
import random
import re
import secrets
import string
import threading
import time
from dataclasses import dataclass

from . import judges, rounds

COUNTDOWN_S = 3      # lobby -> first round
BRIEF_S = 5          # the task card shows this long before the writing clock starts
VERDICT_S = 12       # a verdict stays up this long unless both players press Next (the faces fall)
GRACE_S = 20         # time to reconnect before a gone player forfeits the round
MAX_HP = 100
TIE_DAMAGE = 5       # a tied round, or every judge failing: both take this
FORFEIT_DAMAGE = 40  # times the round's multiplier, no crit
CRIT = 1.25          # a unanimous verdict
NAME_MAX = 16
TOTAL = len(rounds.ROUNDS)
SLOTS = ("p1", "p2")
SOLO = "SOLO"        # the fixed room behind the /solo link (play against yourself in two tabs)


def other(slot):
    return "p2" if slot == "p1" else "p1"


class GameError(Exception):
    """A mistake the player should be told about (sent to them as an `error` event)."""


class Clock:
    """Real time. Tests pass a manual clock with the same three methods."""

    def now(self):
        return time.time()

    def later(self, delay, fn):
        t = threading.Timer(delay, fn)
        t.daemon = True
        t.start()
        return t

    def spawn(self, fn):
        threading.Thread(target=fn, daemon=True).start()


# ---- the rules, as pure functions --------------------------------------------------------

def judged_damage(totals, mult, crit):
    """HP each player loses in a judged round. Base is capped at 40; the multiplier and crit
    come after, so later rounds really hit harder (round 4 maxes out at 75)."""
    a, b = totals["p1"], totals["p2"]
    if a == b:
        return {"p1": TIE_DAMAGE, "p2": TIE_DAMAGE}
    hit = int(min(40, 10 + 3 * abs(a - b)) * mult * (CRIT if crit else 1) + 0.5)
    return {"p1": hit, "p2": 0} if a < b else {"p1": 0, "p2": hit}


def choice_damage(correct):
    """Round 5. `correct` lists the right pickers, fastest first; each right pick hurts the other
    player: the first by CHOICE_DAMAGE[0], the second by CHOICE_DAMAGE[1]. Wrong picks do nothing."""
    dmg = {"p1": 0, "p2": 0}
    for hit, slot in zip(rounds.CHOICE_DAMAGE, correct):
        dmg[other(slot)] += hit
    return dmg


def clean_name(name):
    name = "".join(c for c in str(name or "") if c.isprintable())
    return re.sub(r"\s+", " ", name).strip()[:NAME_MAX] or "Gladiator"


# ---- players and rooms -------------------------------------------------------------------

@dataclass
class Player:
    slot: str
    name: str
    token: str            # private id, what room:rejoin needs; the public id is the slot
    sid: str | None
    hp: int = MAX_HP
    used: int = 0         # characters written this match: the context bar
    no_sweep: bool = False  # /clear forfeits the next checklist-sweep heal
    connected: bool = True
    gone: bool = False    # the reconnect grace ran out
    gen: int = 0          # bumped on disconnect and rejoin so a stale grace timer does nothing
    # per round
    draft: str = ""
    sealed: str | None = None
    pick: str | None = None
    at: int | None = None  # ms, when they sealed or picked
    ready: bool = False
    reset_used: bool = False
    forfeit: bool = False

    def new_round(self):
        self.draft, self.sealed, self.pick, self.at = "", None, None, None
        self.ready = self.reset_used = self.forfeit = False


def locked(fn):
    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        with self.lock:
            return fn(self, *args, **kwargs)
    return wrapper


class Room:
    def __init__(self, code, emit, clock=None, judge=None, rng=None, on_close=None):
        self.code = code
        self.emit = emit                        # emit(event, payload, to=None); to is a slot or None = both
        self.clock = clock or Clock()
        self.judge = judge or judges.judge_round
        self.rng = rng or random.Random()
        self.on_close = on_close or (lambda code: None)
        self.lock = threading.RLock()
        self.players = {}
        self.phase = "lobby"
        self.epoch = 0                          # bumped on every phase change
        self.round_no = 0
        self.rnd = self.offering = self.wildcard = self.options = None
        self.ends_at = 0                        # epoch ms
        self.brief_ends = 0                     # epoch ms: the task card goes, the clock starts
        self.history = []                       # every verdict, for the match report
        self.used = set()                       # offering ids already played
        self.verdict = self.final = None        # kept so a rejoining player can be caught up

    # ---- plumbing ----

    def _goto(self, phase):
        self.phase, self.epoch = phase, self.epoch + 1

    def _later(self, delay, fn, *args):
        epoch = self.epoch

        def run():
            with self.lock:
                if epoch == self.epoch:
                    fn(*args)
        return self.clock.later(delay, run)

    def _need(self, phase):
        if self.phase != phase:
            raise GameError("Not now.")

    def _ctx(self, p):
        return round(min(1.0, p.used / rounds.CONTEXT_MAX), 2)

    def state(self):
        return {"code": self.code, "phase": self.phase, "round": self.round_no, "rounds": TOTAL,
                "players": [{"id": s, "name": p.name, "hp": p.hp, "connected": p.connected,
                             "context": self._ctx(p)} for s, p in sorted(self.players.items())]}

    def _state(self):
        self.emit("room:state", self.state())

    def _start_payload(self):
        o, rnd, wc = self.offering, self.rnd, self.wildcard
        offering = {"id": o["id"]}
        if "file" in o:
            offering["url"] = "/static/offerings/" + o["file"]
        else:
            offering["task"] = o["task"]       # never the hidden checklist: that is for the judges
        return {"round": self.round_no, "kind": rnd["kind"], "title": rnd["title"], "brief": rnd["brief"],
                "maxChars": rnd.get("max_chars", 0), "endsAt": self.ends_at, "briefEndsAt": self.brief_ends,
                "serverNow": int(self.clock.now() * 1000), "offering": offering,
                "options": self.options,
                "optionLabels": {k: rounds.MODELS[k] for k in self.options} if self.options else None,
                "wildcard": {k: wc[k] for k in ("id", "title", "rule")} if wc else None}

    def _clip(self, text):
        return text[:self.rnd.get("max_chars", 0)] if isinstance(text, str) else ""

    # ---- joining and leaving ----

    @locked
    def add_player(self, name, sid):
        if self.phase != "lobby":
            raise GameError("That match has already started.")
        slot = next((s for s in SLOTS if s not in self.players), None)
        if slot is None:
            raise GameError("The room is full.")
        self.players[slot] = Player(slot, clean_name(name), secrets.token_urlsafe(8), sid)
        return self.players[slot]

    @locked
    def hello(self, slot):
        """Tell a new arrival who they are (and their private token), then everyone the room."""
        self._joined(slot)
        self._state()

    def _joined(self, slot):
        p = self.players[slot]
        self.emit("room:joined", {"code": self.code, "you": slot, "token": p.token, "name": p.name}, slot)

    @locked
    def start(self, slot):
        if slot != "p1":
            raise GameError("Only the host can start the match.")
        self._need("lobby")
        if len(self.players) < 2:
            raise GameError("Waiting for a second gladiator.")
        self._goto("countdown")
        self._state()
        self._later(COUNTDOWN_S, self._begin_round, 1)

    @locked
    def disconnect(self, slot, sid):
        p = self.players.get(slot)
        if p is None or p.sid != sid:
            return                              # a stale socket: the player already rejoined
        p.connected, p.sid = False, None
        p.gen += 1
        gen = p.gen
        self._state()
        if self.phase == "finished":
            return self._close_if_empty()

        def expire():
            with self.lock:
                if p.gen == gen and not p.connected:
                    self._grace_expired(slot)
        self.clock.later(GRACE_S, expire)

    @locked
    def rejoin(self, token, sid):
        p = next((q for q in self.players.values() if secrets.compare_digest(q.token, str(token))), None)
        if p is None:
            raise GameError("Could not rejoin that room.")
        p.sid, p.connected, p.gone = sid, True, False
        p.gen += 1                              # cancels a pending grace timer
        self._joined(p.slot)
        self._state()
        s = p.slot
        if self.phase == "writing":
            mine = p.sealed if p.sealed is not None else p.draft
            self.emit("round:start", {**self._start_payload(), "you": {"text": mine, "pick": p.pick},
                                      "sealed": {k: q.sealed is not None or q.pick is not None
                                                 for k, q in self.players.items()}}, s)
        elif self.phase == "judging":
            self.emit("round:judging", {}, s)
        elif self.phase == "verdict":
            self.emit("round:verdict", self.verdict, s)
        elif self.phase == "finished":
            self.emit("match:end", self.final, s)
        return s

    def _grace_expired(self, slot):
        p = self.players[slot]
        p.gone = True
        if self.phase in ("lobby", "countdown") or not any(q.connected for q in self.players.values()):
            return self._abandon()
        if self.phase == "writing":
            self._forfeit_now(slot)
        elif self.phase == "judging":
            p.forfeit = True                    # the verdict, once the judges are done, hits them
        # verdict: the round is settled; `gone` is checked when the next round starts

    @locked
    def yield_(self, slot):
        if self.phase in ("lobby", "countdown"):
            return self._abandon()
        if self.phase != "finished":
            self._end(other(slot), "yield")

    def _abandon(self):
        """The match cannot go on (nobody left, or the lobby emptied): tell whoever remains, close."""
        for s, p in self.players.items():
            if p.connected:
                self.emit("error", {"message": "The match was abandoned."}, s)
        self._goto("finished")
        self.on_close(self.code)

    def _close_if_empty(self):
        if not any(p.connected for p in self.players.values()):
            self.on_close(self.code)

    # ---- a round ----

    def _begin_round(self, n):
        gone = [s for s, p in self.players.items() if p.gone and not p.connected]
        if len(gone) == 2:
            return self._abandon()
        if gone:
            return self._end(other(gone[0]), "disconnect")
        rnd, offering = rounds.draw(n, self.used)
        self.used.add(offering["id"])
        self.round_no, self.rnd, self.offering = n, rnd, offering
        self.wildcard = None
        if rnd["kind"] != "choice" and n > 1 and self.rng.random() < 0.5:   # rounds 2-4 only
            self.wildcard = self.rng.choice(rounds.WILDCARDS)
        seconds = rnd["seconds"]
        if self.wildcard and self.wildcard["id"] == "clepsydra":
            seconds //= 2
        self.options = rounds.options(offering) if rnd["kind"] == "choice" else None
        # ponytail: the card is client-side; the phase is already "writing" and an early seal counts
        self.brief_ends = int((self.clock.now() + BRIEF_S) * 1000)
        self.ends_at = self.brief_ends + seconds * 1000
        for p in self.players.values():
            p.new_round()
        self._goto("writing")
        self.emit("round:start", self._start_payload())
        self._state()
        self._later(BRIEF_S + seconds, self._close_writing)

    @locked
    def draft(self, slot, text):
        p = self.players[slot]
        if self.phase == "writing" and self.rnd["kind"] != "choice" and p.sealed is None:
            p.draft = self._clip(text)          # kept so a time-out can auto-submit it; never echoed

    @locked
    def seal(self, slot, text):
        p = self.players[slot]
        if p.at is not None:
            return                              # double seal: ignored (a time-out auto-submit has no `at`)
        if self.phase != "writing":
            raise GameError("Too late: the round is closed.")
        if self.rnd["kind"] == "choice":
            raise GameError("This round is a multiple choice: pick a card.")
        self._on_time()
        p.sealed, p.at = self._clip(text).strip(), int(self.clock.now() * 1000)
        self.emit("round:sealed", {"playerId": slot, "at": p.at})
        if all(q.sealed is not None for q in self.players.values()):
            self._close_writing()

    @locked
    def choose(self, slot, model):
        p = self.players[slot]
        if p.at is not None:
            return                              # already picked: ignored
        if self.phase != "writing":
            raise GameError("Too late: the round is closed.")
        if self.rnd["kind"] != "choice":
            raise GameError("This round is not a multiple choice.")
        if model not in self.options:
            raise GameError("That is not one of the cards.")
        self._on_time()
        p.pick, p.at = model, int(self.clock.now() * 1000)
        self.emit("round:sealed", {"playerId": slot, "at": p.at})
        if all(q.pick is not None for q in self.players.values()):
            self._settle_choice()

    def _on_time(self):
        if self.clock.now() * 1000 > self.ends_at:
            raise GameError("Too late: the hourglass is empty.")

    def _close_writing(self):
        if self.rnd["kind"] == "choice":
            return self._settle_choice()
        for p in self.players.values():
            if p.sealed is None:
                p.sealed = p.draft.strip()      # time-out: the last draft goes in (empty = empty)
            p.used += len(p.sealed)             # the context bar fills with what was written
        weights = {s: rounds.ROT_MULT if p.used / rounds.CONTEXT_MAX > rounds.ROT_AT else 1.0
                   for s, p in self.players.items()}
        texts = {s: p.sealed for s, p in self.players.items()}
        self._goto("judging")
        self.emit("round:judging", {})
        self._state()
        epoch, rnd, offering, wildcard = self.epoch, self.rnd, self.offering, self.wildcard
        self.clock.spawn(lambda: self._run_judges(epoch, rnd, offering, texts, wildcard, weights))

    def _run_judges(self, epoch, rnd, offering, texts, wildcard, weights):
        """Runs on its own thread: the judges can take 20 s, and the lock must stay free."""
        try:
            result = self.judge(rnd, offering, texts["p1"], texts["p2"], wildcard=wildcard, weights=weights)
        except Exception as e:  # ponytail: any judge failure counts as every Emperor abstaining
            print("judging failed:", repr(e))
            result = None
        with self.lock:
            if epoch == self.epoch:             # not if the match ended while we waited
                self._settle_judged(result)

    # ---- settling a round ----

    def _settle_judged(self, r):
        r = r or {"emperors": [], "totals": None, "unanimous": False,
                  "flagged": {"p1": False, "p2": False}, "sweep": {"p1": False, "p2": False}}
        totals = r["totals"] or {"p1": 0, "p2": 0}   # every judge failed: a tie
        mult = self.rnd["damage_mult"]
        heal = {"p1": 0, "p2": 0}
        crit = False
        forfeit = [s for s, p in self.players.items() if p.forfeit]
        if forfeit:
            dmg = {s: int(FORFEIT_DAMAGE * mult + 0.5) if s in forfeit else 0 for s in SLOTS}
        else:
            crit = bool(r["unanimous"]) and totals["p1"] != totals["p2"]
            dmg = judged_damage(totals, mult, crit)
            for s, p in self.players.items():   # a checklist sweep heals even in a lost round
                if r["sweep"][s]:
                    if p.no_sweep:
                        p.no_sweep = False      # /clear gave this one up
                    else:
                        heal[s] = rounds.SWEEP_HEAL
        keys = ("id", "name", "model", "p1", "p2", "vote", "remark")
        emperors = []
        for e in r["emperors"]:
            # every face lands in a column: a tied Emperor's side is a coin flip, shown as one.
            # Display only: damage and the crit come from the totals and the real votes.
            coin = e["vote"] == "tie"
            pick = ("p1" if self.rng.random() < 0.5 else "p2") if coin else e["vote"]
            emperors.append({**{k: e[k] for k in keys}, "pick": pick, "coin": coin})
        self._verdict(dmg, heal, totals=totals, crit=crit, flagged=r["flagged"], sweep=r["sweep"],
                      emperors=emperors,
                      **({"forfeit": forfeit[0]} if forfeit else {}))

    def _settle_choice(self):
        o = self.offering
        top = max(o["fit"].values())
        picked = {s: p.pick for s, p in self.players.items()}
        right = sorted((s for s in SLOTS if picked[s] and rounds.score_choice(o, picked[s]) == top),
                       key=lambda s: (self.players[s].at, s))   # fastest right pick first
        self._verdict(choice_damage(right), {"p1": 0, "p2": 0},
                      totals={s: rounds.score_choice(o, picked[s]) if picked[s] else 0 for s in SLOTS},
                      prompts={s: rounds.MODELS.get(picked[s], "") for s in SLOTS},
                      picks=picked, correct=right, answer=[k for k, v in o["fit"].items() if v == top])

    def _forfeit_now(self, slot):
        """A player's grace ran out mid-round: they lose it at once, no judging."""
        mult = self.rnd.get("damage_mult", 1.0)
        dmg = {s: int(FORFEIT_DAMAGE * mult + 0.5) if s == slot else 0 for s in SLOTS}
        self._verdict(dmg, {"p1": 0, "p2": 0}, forfeit=slot)

    def _verdict(self, dmg, heal, **extra):
        last = self.round_no >= TOTAL           # before round 5, nobody drops below 1 HP
        for s, p in self.players.items():
            p.hp = min(MAX_HP, max(0 if last else 1, p.hp - dmg[s]) + heal[s])
        hit = max(dmg.values())
        payload = {
            "round": self.round_no, "totals": {"p1": 0, "p2": 0},
            "loser": None if dmg["p1"] == dmg["p2"] else ("p1" if dmg["p1"] > dmg["p2"] else "p2"),
            "damage": hit, "dmg": dmg, "crit": False,
            "flagged": {"p1": False, "p2": False}, "sweep": {"p1": False, "p2": False}, "heal": heal,
            "context": {s: self._ctx(p) for s, p in self.players.items()},
            "hp": {s: p.hp for s, p in self.players.items()},
            "prompts": {s: p.sealed if p.sealed is not None else p.draft for s, p in self.players.items()},
            "emperors": [],
        }
        payload.update(extra)
        self._goto("verdict")
        self.verdict = payload
        task = self.offering.get("task") or self.offering["id"]
        self.history.append({**payload, "title": self.rnd["title"], "task": task})
        self.emit("round:verdict", payload)
        self._state()
        self._later(VERDICT_S, self._advance)

    # ---- between rounds ----

    @locked
    def next(self, slot):
        if self.phase != "verdict":
            return
        self.players[slot].ready = True
        if all(p.ready for p in self.players.values()):
            self._advance()

    def _advance(self):
        if self.round_no >= TOTAL:
            hp = {s: p.hp for s, p in self.players.items()}
            return self._end(None if hp["p1"] == hp["p2"] else max(hp, key=hp.get), "hp")
        self._begin_round(self.round_no + 1)

    @locked
    def reset_context(self, slot, mode):
        p = self.players[slot]
        self._need("verdict")
        if self.round_no >= TOTAL:
            raise GameError("The match is over.")
        if p.reset_used:
            raise GameError("You already used that this round.")
        if mode == "compact":
            lo, hi = rounds.COMPACT_BAND
            heal = rounds.COMPACT_HEAL_IN if lo <= p.used / rounds.CONTEXT_MAX <= hi else rounds.COMPACT_HEAL_OUT
            p.hp, p.used = min(MAX_HP, p.hp + heal), p.used // 2
        elif mode == "clear":
            p.used, p.no_sweep = 0, True
        else:
            raise GameError("Unknown option.")
        p.reset_used = True
        self._state()

    def _end(self, winner, reason):
        self._goto("finished")
        self.final = {"winnerId": winner, "reason": reason,
                      "final": [{"id": s, "hp": p.hp} for s, p in sorted(self.players.items())],
                      "history": self.history}
        self.emit("match:end", self.final)
        self._state()
        self._close_if_empty()


# ---- all the rooms -----------------------------------------------------------------------

class Registry:
    """Rooms by code, and which socket belongs to which player. In memory, one process."""

    def __init__(self, emit_factory=None, clock=None, judge=None):
        self.emit_factory = emit_factory        # emit_factory(code) -> emit(event, payload, to=None)
        self.clock, self.judge = clock, judge
        self.rooms, self.by_sid = {}, {}
        self.lock = threading.Lock()
        self._codes = random.SystemRandom()

    def create(self, name, sid):
        with self.lock:
            for _ in range(200):
                code = "".join(self._codes.choice(string.ascii_uppercase) for _ in range(4))
                if code not in self.rooms:
                    break
            else:
                raise GameError("Could not make a room code, try again.")
            room = Room(code, self.emit_factory(code), self.clock, self.judge, on_close=self.remove)
            self.rooms[code] = room
        return room, room.add_player(name, sid)

    def solo(self, sid):
        """The /solo link: the first tab opens room SOLO, the second joins it.
        Returns (room, player, paired); paired = the second tab arrived, so the match can start.
        A finished SOLO room is replaced; a running one is left alone."""
        with self.lock:
            room = self.rooms.get(SOLO)
            if room and room.phase == "lobby" and len(room.players) == 1:
                return room, room.add_player("Gladiator II", sid), True
            if room and room.phase != "finished":
                raise GameError("A solo match is already on. Finish it, or use the normal lobby.")
            room = Room(SOLO, self.emit_factory(SOLO), self.clock, self.judge, on_close=self.remove)
            self.rooms[SOLO] = room
            return room, room.add_player("Gladiator I", sid), False

    def get(self, code):
        return self.rooms.get(code)

    def remove(self, code):
        with self.lock:
            self.rooms.pop(code, None)
            self.by_sid = {sid: v for sid, v in self.by_sid.items() if v[0] != code}

    def bind(self, sid, code, slot):
        self.by_sid[sid] = (code, slot)

    def unbind(self, sid):
        self.by_sid.pop(sid, None)

    def lookup(self, sid):
        """(room, slot) for a socket, or None."""
        code, slot = self.by_sid.get(sid, (None, None))
        room = self.rooms.get(code)
        return (room, slot) if room else None
