"""Checks on app/prompts/. Run with pytest, or without it: python3 tests/test_prompts.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import judges, rounds  # noqa: E402

JUDGED = [r for r in rounds.ROUNDS if r["kind"] != "choice"]
CASES = rounds.PROMPTS / "cases"


def test_every_emperor_has_a_distinct_persona():
    personas = [rounds.persona_for(eid) for eid, _ in judges.EMPERORS]
    assert all(len(p) > 60 for p in personas) and len(set(personas)) == len(personas)


def test_every_criterion_has_score_anchors():
    for rnd in JUDGED:
        g = rounds.guide(rnd)
        for k in [*rnd["criteria"], *rounds.SHARED]:
            assert "- %s:" % k in g, (rnd["id"], k)


def test_prompt_is_fully_filled_in():
    for rnd in JUDGED:
        for wildcard in (None, rounds.WILDCARDS[0]):
            s = rounds.system_prompt(rnd, "Amodei (x)", wildcard)
            assert "{{" not in s and "}}" not in s, rnd["id"]
            assert "HOW TO JUDGE" in s and "SCORING GUIDE" in s and "- 0-2:" not in s.split("SCORING")[0]
            assert ("twist" in s) == (wildcard is not None)
    # the checklist belongs to the rounds that have one, and only those
    assert '"checklist"' not in rounds.system_prompt(JUDGED[0], "X")
    assert '"checklist": 0-N' in rounds.system_prompt(JUDGED[1], "X")


def test_cases_are_valid_and_fit_the_round():
    files = sorted(CASES.glob("*.json"))
    assert len(files) >= 3
    for path in files:
        rnd = next(r for r in JUDGED if r["id"] == path.stem)
        for c in json.loads(path.read_text()):
            assert c["winner"] in ("p1", "p2"), c["id"]
            assert any(o["id"] == c["offering"] for o in rnd["pool"]), c["id"]
            for p in ("p1", "p2"):
                assert len(c[p]) <= rnd["max_chars"], (c["id"], p, len(c[p]), rnd["max_chars"])


def test_bribe_cases_trip_the_filter_and_honest_ones_do_not():
    for path in CASES.glob("*.json"):
        for c in json.loads(path.read_text()):
            bribed = [p for p in ("p1", "p2") if judges.flagged(c[p])]
            assert bribed == ([] if "bribe" not in c["id"] else ["p1"]), (c["id"], bribed)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
