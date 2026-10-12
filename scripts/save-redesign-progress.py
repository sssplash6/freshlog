#!/usr/bin/env python3
"""Copy redesign work out of session-scoped scratch into a durable directory.

The Sept 2026 UX reorganisation is being produced by long multi-agent workflow
runs whose output lands in two places that do NOT survive a session:

  * /private/tmp/claude-501/<project>/<session>/scratchpad — audit digests and
    the information-architecture proposals (~1.5 MB of writing);
  * <project>/subagents/workflows/<run>/journal.jsonl — one JSON line per
    finished agent, which is the only copy of a result when the run as a whole
    died on a usage limit before it could return.

Three runs were already interrupted mid-flight, so this script exists to make
losing that work impossible: it harvests both places into
~/.claude/projects/<project>/redesign/, which persists across sessions.

Idempotent, additive, and deliberately incapable of failing — it is wired to a
Stop hook (.claude/settings.local.json), and a hook that errors interrupts the
session it was meant to protect. Every unexpected condition is swallowed and
reported on stdout instead.

Run by hand any time:  python3 scripts/save-redesign-progress.py
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import sys

HOME = os.path.expanduser("~")
PROJECT = os.path.join(HOME, ".claude/projects/-Users-workingmyassof-freshform")
DEST = os.path.join(PROJECT, "redesign")
SCRATCH_GLOB = "/private/tmp/claude-501/-Users-workingmyassof-freshform/*/scratchpad"

# A workflow agent's return value is an untagged blob, so it is identified by
# the keys its schema required. Keeps the audit files named for what they are
# rather than agent0.json … agent14.json.
SHAPES = [
    ("critic", {"questionsForOwner"}),
    ("permissions", {"adminScope"}),
    ("color", {"huesPerRoute"}),
    ("copy", {"repeatedPhrases"}),
    ("data-model", {"taxonomyGaps"}),
    ("research", {"navigationRecommendation"}),
    ("components", {"missingPrimitives"}),
    ("walkthrough", {"mondayMorningStory"}),
    ("ia-proposal", {"routeDispositions"}),
    ("judge", {"graftFromLosers"}),
    ("plan", {"decisionsTaken"}),
    ("page-inventory", {"pages", "crossPageNotes"}),
]


def classify(value: object) -> str | None:
    if not isinstance(value, dict):
        return None
    keys = set(value.keys())
    for name, required in SHAPES:
        if required <= keys:
            return name
    return None


def newer(src: str, dst: str) -> bool:
    """True when src should be copied: dst missing, or src changed since."""
    if not os.path.exists(dst):
        return True
    return os.path.getmtime(src) > os.path.getmtime(dst) or os.path.getsize(
        src
    ) != os.path.getsize(dst)


def copy_tree(src_dir: str, dst_dir: str, exts: tuple[str, ...]) -> int:
    copied = 0
    if not os.path.isdir(src_dir):
        return 0
    os.makedirs(dst_dir, exist_ok=True)
    for name in sorted(os.listdir(src_dir)):
        if not name.endswith(exts):
            continue
        src, dst = os.path.join(src_dir, name), os.path.join(dst_dir, name)
        if os.path.isfile(src) and newer(src, dst):
            shutil.copy2(src, dst)
            copied += 1
    return copied


def harvest_journals() -> tuple[int, int]:
    """Split every workflow journal into one file per agent result.

    Named <run>-<shape>[-n].json so a shape appearing several times in one run
    (three walkthroughs, three judges) does not overwrite itself.
    """
    saved = runs = 0
    out = os.path.join(DEST, "workflows")
    os.makedirs(out, exist_ok=True)
    pattern = os.path.join(PROJECT, "*/subagents/workflows/*/journal.jsonl")
    for journal in sorted(glob.glob(pattern)):
        run = os.path.basename(os.path.dirname(journal))
        runs += 1
        seen: dict[str, int] = {}
        try:
            lines = open(journal, encoding="utf-8").read().splitlines()
        except OSError as exc:
            print(f"  ! unreadable {journal}: {exc}")
            continue
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                continue  # a partially flushed line while a run is live
            if record.get("type") != "result":
                continue
            value = record.get("result", record.get("value"))
            shape = classify(value) or "result"
            n = seen.get(shape, 0)
            seen[shape] = n + 1
            suffix = "" if n == 0 else f"-{n + 1}"
            path = os.path.join(out, f"{run}-{shape}{suffix}.json")
            body = json.dumps(value, indent=1, ensure_ascii=False)
            if os.path.exists(path) and open(path, encoding="utf-8").read() == body:
                continue
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(body)
            saved += 1
    return saved, runs


def main() -> int:
    os.makedirs(DEST, exist_ok=True)
    tally: list[str] = []

    for scratch in sorted(glob.glob(SCRATCH_GLOB)):
        for sub, exts in (("audit", (".json", ".txt", ".md")), ("design", (".md",))):
            n = copy_tree(os.path.join(scratch, sub), os.path.join(DEST, sub), exts)
            if n:
                tally.append(f"{n} {sub} file(s)")

    saved, runs = harvest_journals()
    if saved:
        tally.append(f"{saved} agent result(s) from {runs} workflow run(s)")

    # The plan itself is committed to the repo, so it only needs a mirror here
    # for the case where the repo copy is rewritten by a later phase.
    plan = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "REDESIGN.md")
    if os.path.exists(plan) and newer(plan, os.path.join(DEST, "REDESIGN.md")):
        shutil.copy2(plan, os.path.join(DEST, "REDESIGN.md"))
        tally.append("REDESIGN.md")

    print(
        f"redesign progress saved → {DEST}: " + ", ".join(tally)
        if tally
        else f"redesign progress already current in {DEST}"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # a protective hook must never break the session
        print(f"save-redesign-progress: skipped ({exc})")
        sys.exit(0)
