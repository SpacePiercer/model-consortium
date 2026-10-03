"""
Play a whole match against a running server with two bots: the check to run after a deploy.

    .venv/bin/python scripts/smoke.py [URL]          (default http://localhost:5001)

Both bots seal at once and press Next, so a match takes seconds, not minutes. If the server has
JUDGES=live this uses the real judges (a handful of API calls). Exits 0 only if all five verdicts
and a match:end arrive over a websocket and the server sent no error.
Needs the dev extras: .venv/bin/pip install -r requirements-dev.txt
"""
import sys
import threading
import time

import socketio

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5001"


class Bot:
    def __init__(self, name, text, pick, host):
        self.name, self.text, self.pick, self.host = name, text, pick, host
        self.sio = socketio.Client()
        self.code, self.started, self.end = None, False, None
        self.verdicts, self.errors, self.opened, self.took = [], [], {}, {}
        self.done = threading.Event()
        for event, handler in (("room:joined", self.on_joined), ("room:state", self.on_state),
                               ("round:start", self.on_round), ("round:verdict", self.on_verdict),
                               ("match:end", self.on_end), ("error", lambda e: self.errors.append(e["message"]))):
            self.sio.on(event, handler)

    def on_joined(self, j):
        self.code = j["code"]

    def on_state(self, s):
        if self.host and s["phase"] == "lobby" and len(s["players"]) == 2 and not self.started:
            self.started = True
            self.sio.emit("room:start", {})

    def on_round(self, r):
        self.opened[r["round"]] = time.time()
        if r["kind"] == "choice":
            self.sio.emit("round:choose", {"model": r["options"][self.pick]})
        else:
            self.sio.emit("round:seal", {"text": self.text})

    def on_verdict(self, v):
        self.verdicts.append(v)
        self.took[v["round"]] = time.time() - self.opened.get(v["round"], time.time())
        self.sio.emit("round:next", {})

    def on_end(self, m):
        self.end = m
        self.done.set()


def main():
    ann = Bot("Ann", "A detailed prompt that names the subject, the style, the framing and the limits.", 0, True)
    bob = Bot("Bob", "A short one.", 1, False)
    t0 = time.time()
    ann.sio.connect(URL, wait_timeout=15)
    ann.sio.emit("room:create", {"name": "SmokeAnn"})
    while ann.code is None and time.time() - t0 < 15:
        time.sleep(0.1)
    if ann.code is None:
        sys.exit("FAIL: could not create a room " + str(ann.errors))
    bob.sio.connect(URL, wait_timeout=15)
    bob.sio.emit("room:join", {"code": ann.code, "name": "SmokeBob"})
    finished = ann.done.wait(240) and bob.done.wait(10)
    transports = (ann.sio.transport(), bob.sio.transport())
    for bot in (ann, bob):
        bot.sio.disconnect()

    print("server   %s" % URL)
    print("room     %s, %.1f s in all" % (ann.code, time.time() - t0))
    print("rounds   %s" % ", ".join("%d: %.1f s" % (r, s) for r, s in sorted(ann.took.items())))
    for v in ann.verdicts:
        who = ", ".join("%s %s:%s" % (e["name"], e["p1"], e["p2"]) for e in v["emperors"]) or "no judges"
        print("  round %d  totals %s  damage %s  hp %s  (%s)" % (v["round"], v["totals"], v["dmg"], v["hp"], who))
    print("end      %s" % ann.end)
    problems = []
    if not finished:
        problems.append("the match did not finish in time")
    if [v["round"] for v in ann.verdicts] != [1, 2, 3, 4, 5]:
        problems.append("expected verdicts for rounds 1-5, got %s" % [v["round"] for v in ann.verdicts])
    if transports != ("websocket", "websocket"):
        problems.append("transport was %s, not websocket (is simple-websocket installed? does the host allow websockets?)" % (transports,))
    if ann.errors or bob.errors:
        problems.append("the server sent errors: %s" % (ann.errors + bob.errors))
    if problems:
        sys.exit("FAIL: " + "; ".join(problems))
    print("OK: a full 5-round match over %s" % transports[0])


if __name__ == "__main__":
    main()
