"""Room tests, on a manual clock. Run with pytest, or without it: python3.11 tests/test_rooms.py
(needs the venv: .venv/bin/python tests/test_rooms.py)"""
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app, rooms, rounds  # noqa: E402


class Handle:
    def __init__(self, at, fn):
        self.at, self.fn, self.cancelled = at, fn, False

    def cancel(self):
        self.cancelled = True


class ManualClock:
    """Time that only moves when the test says so. spawn() runs at once unless sync=False."""

    def __init__(self, sync=True):
        self.t, self.timers, self.sync, self.pending = 1_000.0, [], sync, []

    def now(self):
        return self.t

    def later(self, delay, fn):
        h = Handle(self.t + delay, fn)
        self.timers.append(h)
        return h

    def spawn(self, fn):
        (fn() if self.sync else self.pending.append(fn))

    def run_spawned(self):
        todo, self.pending = self.pending, []
        for fn in todo:
            fn()

    def advance(self, seconds):
        end = self.t + seconds
        while True:
            due = sorted((h for h in self.timers if not h.cancelled and h.at <= end), key=lambda h: h.at)
            if not due:
                break
            self.timers.remove(due[0])
            self.t = max(self.t, due[0].at)
            due[0].fn()
        self.t = end


class Recorder:
    def __init__(self):
        self.events = []

    def __call__(self, event, payload, to=None):
        self.events.append((event, payload, to))

    def of(self, event, to=None):
        return [p for e, p, t in self.events if e == event and (to is None or t == to)]

    def last(self, event):
        return self.of(event)[-1]


class NoWildcards:
    def random(self):
        return 0.99


class Wildcard(NoWildcards):
    """Every round 2-4 draws the wildcard with this id."""

    def __init__(self, wid):
        self.wid = wid

    def random(self):
        return 0.0

    def choice(self, seq):
        return next(w for w in seq if w["id"] == self.wid)


def result(t1, t2, unanimous=False, sweep=(False, False), flagged=(False, False)):
    vote = "p1" if t1 > t2 else "p2" if t2 > t1 else "tie"
    emps = [{"id": i, "name": n, "model": "stub", "p1": t1 // 2, "p2": t2 // 2, "vote": vote, "remark": "ok"}
            for i, n in (("amodei", "Amodei"), ("altman", "Altmanvs"))]
    return {"emperors": emps, "totals": {"p1": t1, "p2": t2}, "unanimous": unanimous,
            "flagged": dict(zip(("p1", "p2"), flagged)), "sweep": dict(zip(("p1", "p2"), sweep))}


class Judge:
    def __init__(self, *results, fail=False):
        self.results, self.fail, self.calls = results or (result(30, 20),), fail, []

    def __call__(self, rnd, offering, p1, p2, wildcard=None, weights=None):
        self.calls.append({"round": rnd["id"], "p1": p1, "p2": p2, "wildcard": wildcard, "weights": weights})
        if self.fail:
            raise RuntimeError("judges are down")
        return self.results[min(len(self.calls) - 1, len(self.results) - 1)]


def make_room(judge=None, rng=None, sync=True):
    clock, out = ManualClock(sync), Recorder()
    room = rooms.Room("TEST", out, clock, judge or Judge(), rng or NoWildcards())
    room.add_player("Ann", "sid-a")
    room.add_player("Bob", "sid-b")
    room.hello("p1")
    room.hello("p2")
    return room, clock, out


def start(**kw):
    room, clock, out = make_room(**kw)
    room.start("p1")
    clock.advance(rooms.COUNTDOWN_S)
    return room, clock, out


def seal_both(room, a="alpha", b="beta"):
    room.seal("p1", a)
    room.seal("p2", b)


def to_round(room, clock, n):
    """Play rounds out (both seal at once) until round n is open for writing."""
    while room.round_no < n:
        if room.phase == "writing":
            if room.rnd["kind"] == "choice":
                room.choose("p1", room.options[0])
                room.choose("p2", room.options[0])
            else:
                seal_both(room)
        clock.advance(rooms.VERDICT_S)


def raises(fn, *args):
    try:
        fn(*args)
    except rooms.GameError:
        return True
    return False


def correct_card(room):
    top = max(room.offering["fit"].values())
    return next(m for m in room.options if room.offering["fit"].get(m, 0) == top)


def wrong_card(room):
    top = max(room.offering["fit"].values())
    return next(m for m in room.options if room.offering["fit"].get(m, 0) < top)


# ---- the rules as pure functions ---------------------------------------------------------

def test_damage_formula():
    assert rooms.judged_damage({"p1": 26, "p2": 33}, 1.0, False) == {"p1": 31, "p2": 0}   # the spec's example
    assert rooms.judged_damage({"p1": 26, "p2": 33}, 1.0, True) == {"p1": 39, "p2": 0}    # 31 * 1.25
    assert rooms.judged_damage({"p1": 40, "p2": 0}, 1.5, True) == {"p1": 0, "p2": 75}     # round 4's maximum
    assert rooms.judged_damage({"p1": 20, "p2": 20}, 1.5, True) == {"p1": 5, "p2": 5}     # a tie is flat
    assert rooms.judged_damage({"p1": 21, "p2": 20}, 1.0, False) == {"p1": 0, "p2": 13}


def test_choice_damage():
    assert rooms.choice_damage(["p1", "p2"]) == {"p1": 5, "p2": 15}   # p1 was first: p2 takes 15
    assert rooms.choice_damage(["p2"]) == {"p1": 15, "p2": 0}
    assert rooms.choice_damage([]) == {"p1": 0, "p2": 0}


def test_names_are_cleaned():
    assert rooms.clean_name("  Vova \n the   Bold and then some more ") == "Vova the Bold an"
    assert rooms.clean_name("") == rooms.clean_name(None) == "Gladiator"


# ---- lobby -------------------------------------------------------------------------------

def test_lobby_rules():
    room, clock, out = make_room()
    assert raises(room.start, "p2")                        # only the host starts
    assert raises(room.add_player, "Cy", "sid-c")          # two players max
    solo = rooms.Room("SOLO", Recorder(), ManualClock())
    solo.add_player("Ann", "s")
    assert raises(solo.start, "p1")                        # needs an opponent
    room.start("p1")
    assert room.phase == "countdown" and raises(room.start, "p1")
    assert raises(room.add_player, "Cy", "sid-c")
    clock.advance(rooms.COUNTDOWN_S - 1)
    assert room.phase == "countdown"
    clock.advance(1)
    assert room.phase == "writing" and room.round_no == 1


def test_a_vanished_lobby_closes():
    closed = []
    room, clock, out = make_room()
    room.on_close = closed.append
    room.disconnect("p2", "sid-b")
    clock.advance(rooms.GRACE_S)
    assert closed == ["TEST"] and "error" in [e for e, _, _ in out.events]


# ---- a round -----------------------------------------------------------------------------

def test_round_start_hides_the_checklist():
    room, clock, out = start()
    first = out.last("round:start")
    assert first["round"] == 1 and first["kind"] == "image" and first["maxChars"] == 300
    assert first["offering"]["url"].startswith("/static/offerings/") and first["options"] is None
    for n in (2, 3, 4):
        to_round(room, clock, n)
        p = out.last("round:start")
        assert "task" in p["offering"] and p["maxChars"] == rounds.round_for(n)["max_chars"]
        assert "checklist" not in json.dumps(p) and "fit" not in json.dumps(p)
    to_round(room, clock, 5)
    p = out.last("round:start")
    assert p["kind"] == "choice" and len(p["options"]) == 4 and set(p["optionLabels"]) == set(p["options"])
    assert "fit" not in json.dumps(p)


def test_seal_is_sealed_clipped_and_final():
    room, clock, out = start()
    room.seal("p1", "x" * 999)
    assert len(room.players["p1"].sealed) == 300           # round 1's limit
    room.seal("p1", "second try")                          # a double seal is ignored
    assert room.players["p1"].sealed == "x" * 300
    sealed = out.of("round:sealed")
    assert len(sealed) == 1 and sealed[0]["playerId"] == "p1" and set(sealed[0]) == {"playerId", "at"}
    assert room.phase == "writing"                         # still waiting for p2


def test_both_sealed_closes_the_round_early():
    judge = Judge()
    room, clock, out = start(judge=judge)
    seal_both(room, "red lighthouse", "blue cat")
    assert room.phase == "verdict" and judge.calls[0]["p1"] == "red lighthouse"
    clock.advance(rooms.VERDICT_S - 1)
    assert len(out.of("round:verdict")) == 1 and room.round_no == 1
    clock.advance(1)
    assert room.round_no == 2 and len(judge.calls) == 1    # the old hourglass did not fire a 2nd judging


def test_timeout_submits_the_last_draft():
    judge = Judge()
    room, clock, out = start(judge=judge)
    room.draft("p1", "a half-written prompt")
    room.draft("p1", "a half-written prompt, now longer")
    clock.advance(59)
    assert room.phase == "writing"
    clock.advance(1)
    assert judge.calls[0]["p1"] == "a half-written prompt, now longer" and judge.calls[0]["p2"] == ""
    verdict = out.last("round:verdict")
    assert verdict["prompts"] == {"p1": "a half-written prompt, now longer", "p2": ""}
    assert raises(room.seal, "p1", "too late")
    # drafts and sealed texts only appear at the verdict, never while the opponent is writing
    before = [p for e, p, t in out.events[:out.events.index(("round:verdict", verdict, None))]]
    assert "half-written" not in json.dumps(before)


def test_seal_after_the_hourglass_is_rejected():
    room, clock, out = start()
    clock.t = room.ends_at / 1000 + 0.5                   # the timer has not fired yet, the time is up
    assert raises(room.seal, "p1", "late")


def test_pictures_we_do_not_have_are_never_drawn_while_others_exist():
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "starry-night.jpg").write_bytes(b"x")
        with patch.object(rounds, "OFFERINGS", Path(d)):
            assert {rounds.draw(1)[1]["id"] for _ in range(60)} == {"starry-night"}
            (Path(d) / "great-wave.jpg").write_bytes(b"x")
            assert {rounds.draw(1)[1]["id"] for _ in range(80)} == {"starry-night", "great-wave"}
            assert {rounds.draw(1, used={"starry-night"})[1]["id"] for _ in range(40)} == {"great-wave"}
    with patch.object(rounds, "OFFERINGS", Path("/nonexistent")):
        assert len({rounds.draw(1)[1]["id"] for _ in range(100)}) > 2     # no pictures at all: the whole pool


def test_judges_all_failing_is_a_tie():
    room, clock, out = start(judge=Judge(fail=True))
    seal_both(room)
    v = out.last("round:verdict")
    assert v["dmg"] == {"p1": 5, "p2": 5} and v["loser"] is None and v["emperors"] == []


def test_wildcards_only_in_rounds_2_to_4_and_clepsydra_halves_time():
    judge = Judge()
    room, clock, out = start(judge=judge, rng=Wildcard("clepsydra"))
    assert out.last("round:start")["wildcard"] is None     # never round 1
    seal_both(room)
    clock.advance(rooms.VERDICT_S)
    p = out.last("round:start")
    assert p["wildcard"]["id"] == "clepsydra" and p["endsAt"] - p["serverNow"] == 30_000
    seal_both(room)
    assert judge.calls[1]["wildcard"]["id"] == "clepsydra"  # the judges are told the twist
    to_round(room, clock, 5)
    assert out.last("round:start")["wildcard"] is None     # never round 5


# ---- damage, healing, the context bar ----------------------------------------------------

def test_a_five_round_match_with_last_stand():
    judge = Judge(result(40, 0))                           # p2 loses every judged round, by the maximum
    room, clock, out = start(judge=judge)
    for n in (1, 2, 3, 4):
        to_round(room, clock, n)
        seal_both(room)
        v = out.last("round:verdict")
        assert v["round"] == n and v["loser"] == "p2" and v["hp"]["p2"] >= 1, v   # nobody below 1 HP yet
    assert [v["damage"] for v in out.of("round:verdict")] == [40, 40, 50, 60]      # x1.0 x1.0 x1.25 x1.5
    assert [v["hp"]["p2"] for v in out.of("round:verdict")] == [60, 20, 1, 1]
    to_round(room, clock, 5)
    room.choose("p1", correct_card(room))
    room.choose("p2", wrong_card(room))
    v = out.last("round:verdict")
    assert v["round"] == 5 and v["correct"] == ["p1"] and v["dmg"] == {"p1": 0, "p2": 15}
    assert v["hp"] == {"p1": 100, "p2": 0}                 # in round 5 the last stand is over
    clock.advance(rooms.VERDICT_S)
    end = out.last("match:end")
    assert end["winnerId"] == "p1" and end["reason"] == "hp" and end["final"] == [
        {"id": "p1", "hp": 100}, {"id": "p2", "hp": 0}]
    assert room.phase == "finished"


def test_equal_hp_after_round_5_is_a_draw():
    room, clock, out = start(judge=Judge(result(20, 20)))
    to_round(room, clock, 5)
    room.choose("p1", wrong_card(room))
    room.choose("p2", wrong_card(room))
    clock.advance(rooms.VERDICT_S)
    end = out.last("match:end")
    assert end["winnerId"] is None and end["reason"] == "hp"


def test_crit_flag_comes_from_the_judges():
    room, clock, out = start(judge=Judge(result(10, 30, unanimous=True)))
    seal_both(room)
    v = out.last("round:verdict")
    assert v["crit"] is True and v["damage"] == 50 and v["loser"] == "p1"   # min(40, 70) * 1.0 * 1.25


def test_sweep_heals_even_in_a_lost_round():
    room, clock, out = start(judge=Judge(result(10, 30, sweep=(True, False))))
    seal_both(room)
    v = out.last("round:verdict")
    assert v["hp"] == {"p1": 100 - 40 + 5, "p2": 100} and v["heal"] == {"p1": 5, "p2": 0}


def test_context_rot_weights_reach_the_judges():
    judge = Judge()
    room, clock, out = start(judge=judge)
    room.seal("p1", "a" * 300)
    room.seal("p2", "b")
    assert judge.calls[0]["weights"] == {"p1": 1.0, "p2": 1.0}       # 300 of 600: fine
    clock.advance(rooms.VERDICT_S)
    room.seal("p1", "a" * 250)
    room.seal("p2", "b")
    assert judge.calls[1]["weights"] == {"p1": 0.8, "p2": 1.0}       # 550 of 600 is above 85%: rot
    assert out.last("round:verdict")["context"] == {"p1": 0.92, "p2": 0.0}


def test_compact_heals_more_inside_the_band_and_halves_the_bar():
    room, clock, out = start(judge=Judge(result(20, 30)))          # p1 loses 40 a round
    assert raises(room.reset_context, "p1", "compact")             # only on the verdict screen
    seal_both(room)
    room.players["p1"].used = 400                                  # 67%: inside the 60-85% band
    room.reset_context("p1", "compact")
    p = room.players["p1"]
    assert (p.hp, p.used) == (60 + 10, 200)
    assert raises(room.reset_context, "p1", "clear")               # once per round
    assert room.state()["players"][0]["hp"] == 70
    clock.advance(rooms.VERDICT_S)
    seal_both(room)                                                # round 2: 70 - 40 = 30
    room.players["p1"].used = 100                                  # 17%: outside the band
    room.reset_context("p1", "compact")
    assert (room.players["p1"].hp, room.players["p1"].used) == (33, 50)
    assert raises(room.reset_context, "p1", "compact")             # and once per round, every round
    clock.advance(rooms.VERDICT_S)
    seal_both(room)
    assert raises(room.reset_context, "p2", "nonsense")            # unknown option


def test_clear_empties_the_bar_and_forfeits_the_next_sweep():
    room, clock, out = start(judge=Judge(result(30, 20, sweep=(True, False))))   # p2 loses, p1 sweeps
    seal_both(room)
    room.players["p1"].hp = 50
    room.reset_context("p1", "clear")
    p = room.players["p1"]
    assert p.used == 0 and p.no_sweep
    clock.advance(rooms.VERDICT_S)
    seal_both(room)
    assert out.last("round:verdict")["heal"]["p1"] == 0 and not p.no_sweep and p.hp == 50
    clock.advance(rooms.VERDICT_S)
    seal_both(room)
    assert out.last("round:verdict")["heal"]["p1"] == 5 and p.hp == 55


def test_reset_is_refused_after_the_last_round():
    room, clock, out = start()
    to_round(room, clock, 5)
    room.choose("p1", room.options[0])
    room.choose("p2", room.options[0])
    assert raises(room.reset_context, "p1", "compact")


# ---- the choice round --------------------------------------------------------------------

def test_choice_round_fastest_correct_pick_hits_hardest():
    room, clock, out = start()
    to_round(room, clock, 5)
    good = correct_card(room)
    room.choose("p2", good)
    clock.advance(2)
    room.choose("p1", good)
    v = out.last("round:verdict")
    assert v["correct"] == ["p2", "p1"] and v["dmg"] == {"p1": 15, "p2": 5} and v["loser"] == "p1"
    assert v["answer"] and good in v["answer"]


def test_choice_round_rules():
    room, clock, out = start()
    to_round(room, clock, 5)
    assert raises(room.choose, "p1", "no-such-model")
    assert raises(room.seal, "p1", "a prompt")                     # not a writing round
    bad, before = wrong_card(room), len(out.of("round:sealed"))
    room.choose("p1", bad)
    room.choose("p1", correct_card(room))                          # a second pick is ignored
    assert room.players["p1"].pick == bad
    assert len(out.of("round:sealed")) - before == 1
    clock.advance(15)                                              # p2 never answers: the hourglass ends it
    v = out.last("round:verdict")
    assert v["picks"] == {"p1": bad, "p2": None} and v["dmg"] == {"p1": 0, "p2": 0} and v["correct"] == []


# ---- leaving and coming back -------------------------------------------------------------

def test_rejoin_within_the_grace_keeps_the_round():
    room, clock, out = start()
    token = room.players["p1"].token
    room.draft("p1", "my draft")
    room.disconnect("p1", "sid-a")
    assert room.state()["players"][0]["connected"] is False
    clock.advance(rooms.GRACE_S - 1)
    assert room.rejoin(token, "sid-a2") == "p1"
    room.disconnect("p1", "sid-a")                                 # the old socket dying late changes nothing
    clock.advance(30)
    assert room.phase == "writing" and room.players["p1"].connected
    mine = out.of("round:start", to="p1")[-1]
    assert mine["you"] == {"text": "my draft", "pick": None} and mine["sealed"] == {"p1": False, "p2": False}
    assert raises(room.rejoin, "wrong-token", "sid-x")


def test_a_gone_player_forfeits_the_round_then_the_match():
    judge = Judge()
    room, clock, out = start(judge=judge)
    to_round(room, clock, 3)                                       # the multiplier is 1.25 here
    room.disconnect("p1", "sid-a")
    clock.advance(rooms.GRACE_S)
    v = out.last("round:verdict")
    assert v["round"] == 3 and v["forfeit"] == "p1" and v["dmg"] == {"p1": 50, "p2": 0} and v["crit"] is False
    assert len(judge.calls) == 2                                   # rounds 1 and 2 only: no judging for a forfeit
    clock.advance(rooms.VERDICT_S)                                 # still gone when round 4 would start
    end = out.last("match:end")
    assert end["winnerId"] == "p2" and end["reason"] == "disconnect"


def test_coming_back_after_a_forfeit_saves_the_match():
    room, clock, out = start()
    token = room.players["p1"].token
    room.disconnect("p1", "sid-a")
    clock.advance(rooms.GRACE_S)
    assert out.last("round:verdict")["forfeit"] == "p1"
    room.rejoin(token, "sid-a2")                                   # back before the next round starts
    assert out.of("round:verdict", to="p1")                        # and caught up on the verdict
    clock.advance(rooms.VERDICT_S)
    assert room.phase == "writing" and room.round_no == 2 and not out.of("match:end")


def test_a_player_who_leaves_while_the_judges_work_loses_the_round():
    room, clock, out = start(judge=Judge(result(30, 10)), sync=False)   # p1 would have won
    seal_both(room)
    assert room.phase == "judging"
    room.disconnect("p1", "sid-a")
    clock.advance(rooms.GRACE_S)
    assert room.phase == "judging"
    clock.run_spawned()                                            # the judges finally answer
    v = out.last("round:verdict")
    assert v["forfeit"] == "p1" and v["dmg"] == {"p1": 40, "p2": 0}


def test_yield_ends_the_match_at_once():
    room, clock, out = start()
    room.yield_("p1")
    assert out.last("match:end") == {"winnerId": "p2", "reason": "yield",
                                     "final": [{"id": "p1", "hp": 100}, {"id": "p2", "hp": 100}]}
    clock.advance(300)                                             # the round's timers do nothing now
    assert len(out.of("match:end")) == 1 and not out.of("round:verdict")


def test_a_judge_result_that_arrives_after_the_match_ended_is_dropped():
    room, clock, out = start(sync=False)
    seal_both(room)
    room.yield_("p2")
    clock.run_spawned()
    assert not out.of("round:verdict") and room.phase == "finished"


# ---- the socket layer --------------------------------------------------------------------

def received(client, name):
    return [m["args"][0] for m in client.get_received() if m["name"] == name]


def test_socket_flow_privacy_and_rejoin():
    clock = ManualClock()
    app = create_app(clock=clock, judge=Judge())
    a, b = app.socketio.test_client(app), app.socketio.test_client(app)

    a.emit("room:create", {"name": "Ann"})
    mine = received(a, "room:joined")[0]
    code = mine["code"]
    assert mine["you"] == "p1" and len(code) == 4 and mine["token"]

    b.emit("room:join", {"code": code.lower(), "name": "Bob"})
    theirs = received(b, "room:joined")[0]
    assert theirs["you"] == "p2" and theirs["token"] != mine["token"]
    assert theirs["token"] not in json.dumps(a.get_received())    # the opponent never sees your token

    b.emit("room:start", {})
    assert "host" in received(b, "error")[0]["message"]
    a.emit("room:start", {})
    clock.advance(rooms.COUNTDOWN_S)
    assert received(a, "round:start")[0]["round"] == 1 and received(b, "round:start")[0]["round"] == 1

    a.emit("round:seal", {"text": "hello"})
    sealed = received(b, "round:sealed")
    assert sealed[0]["playerId"] == "p1" and "hello" not in json.dumps(sealed)
    b.emit("round:seal", {"text": "world"})
    verdict = received(b, "round:verdict")[0]
    assert verdict["prompts"] == {"p1": "hello", "p2": "world"} and verdict["round"] == 1

    a.disconnect()                                                 # a page refresh
    a2 = app.socketio.test_client(app)
    a2.emit("room:rejoin", {"code": code, "playerId": mine["token"]})
    again = [m["name"] for m in a2.get_received()]
    assert "room:joined" in again and "round:verdict" in again
    a2.emit("room:rejoin", {"code": code, "playerId": "wrong"})
    assert "error" in [m["name"] for m in a2.get_received()]


def test_socket_errors_are_polite():
    app = create_app(clock=ManualClock(), judge=Judge())
    c = app.socketio.test_client(app)
    c.emit("round:seal", {"text": "x"})
    assert received(c, "error")[0]["message"] == "You are not in a room."
    c.emit("room:join", {"code": "ZZZZ", "name": "x"})
    assert received(c, "error")[0]["message"] == "No room with that code."
    c.emit("room:join", "not even a dict")
    assert received(c, "error")                                    # junk payloads don't crash anything
    c.emit("room:create", {"name": "Ann"})
    c.emit("room:create", {"name": "Ann again"})
    assert "already" in received(c, "error")[-1]["message"]


def test_the_index_page_is_served():
    app = create_app(clock=ManualClock(), judge=Judge())
    r = app.test_client().get("/")
    assert r.status_code == 200 and b"Prompt Colosseum" in r.data


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
