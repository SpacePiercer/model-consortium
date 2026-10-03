"""
Do the Emperors agree with us? Runs the sample testimonies in app/prompts/cases/ through the
live judges and checks who wins. Costs real API calls (one per judge per case).

    python3 app/calibrate.py [round_id ...]      e.g. python3 app/calibrate.py minister
"""
import json
import sys
import time
from pathlib import Path

try:
    from . import judges, rounds
except ImportError:  # run as a script
    import judges
    import rounds

CASES = Path(__file__).resolve().parent / "prompts" / "cases"
PAUSE = 10  # seconds between cases: Groq's free tier allows about 8000 tokens a minute


def main(argv):
    judges._seats = judges.real_seats()  # no fake fillers: their random scores would be noise
    if not judges._seats:
        sys.exit("No judges registered. Fill in .env first.")
    judged = [r for r in rounds.ROUNDS if r["kind"] != "choice"]
    ids = argv[1:] or [r["id"] for r in judged]
    hits = total = 0
    for rnd in (r for r in judged if r["id"] in ids):
        path = CASES / (rnd["id"] + ".json")
        if not path.exists():
            print("\n%s: no cases yet (%s)" % (rnd["title"], path.name))
            continue
        print("\n== %s ==" % rnd["title"])
        for case in json.loads(path.read_text()):
            if total:
                time.sleep(PAUSE)
            offering = next(o for o in rnd["pool"] if o["id"] == case["offering"])
            res = judges.judge_round(rnd, offering, case["p1"], case["p2"])
            t = res["totals"]
            got = None if t is None else "p1" if t["p1"] > t["p2"] else "p2" if t["p2"] > t["p1"] else "tie"
            total, hits = total + 1, hits + (got == case["winner"])
            panel = "  ".join("%s %s" % (e["name"], "%d-%d" % (e["p1"], e["p2"]) if e["vote"] else "abstained")
                              for e in res["emperors"])
            print("  %s %-34s expected %s, got %s %s\n      %s" % (
                "ok  " if got == case["winner"] else "MISS", case["id"], case["winner"], got,
                "" if t is None else "(%d-%d)" % (t["p1"], t["p2"]), panel))
    print("\n%d of %d cases went the expected way" % (hits, total))


if __name__ == "__main__":
    main(sys.argv)
