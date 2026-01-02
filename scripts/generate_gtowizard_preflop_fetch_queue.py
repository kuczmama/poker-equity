#!/usr/bin/env python3
"""
Generate an *offline* fetch queue for all 7-handed preflop solutions you listed (up to 6-bet jam/call).

This script does NOT call GTOWizard. It only:
- Generates the list of desired spots with consistent filenames
- Checks data/import_ranges/ for already-downloaded files to avoid duplicates
- Writes one-spot "queue files" you can run *one at a time* via:
    python3 scripts/fetch_gtowizard_spot_solutions.py --spots <queue-file> --out-dir data/import_ranges ...

Important limitation:
- We can generate RFI spots with correct `preflop_actions` (fold chains).
- For 3bet/4bet/5bet/6bet nodes, GTOWizard requires action codes/sizes in `preflop_actions`
  (e.g. R12, R22, RAI). Those sizes/codes are not safely inferable offline.
  So this generator emits those spots as "NEEDS_DISCOVERY" with a human-readable action line.

Later you can either:
- Fill in the `preflop_actions` for those spots manually, OR
- Use the existing networked helper script `scripts/generate_gtowizard_7max_preflop_spots.py`
  (slow + rate-limited) to discover the exact action codes for your chosen gametype/depth.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


GTOW_POS_ORDER = ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]

# Your 7-max library seats:
SEATS_7MAX = ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"]

# Approximation: our UTG == GTOW UTG+2
SEAT_TO_GTOW_OPEN_POS = {
    "UTG": "UTG+2",
    "LJ": "LJ",
    "HJ": "HJ",
    "CO": "CO",
    "BTN": "BTN",
    "SB": "SB",
}


@dataclass(frozen=True)
class Spot:
    output_file: str
    description: str
    params: Dict[str, str]
    status: str  # MISSING | PRESENT | NEEDS_DISCOVERY
    action_line: Optional[str] = None


def _idx(pos: str) -> int:
    try:
        return GTOW_POS_ORDER.index(pos)
    except ValueError as e:
        raise ValueError(f"Unknown GTOW position: {pos}") from e


def _fold_chain_to_pos(pos: str) -> str:
    """
    Build a fold-only preflop_actions string up to (but not including) pos.
    Example: for GTOW UTG+2 => "F-F"
             for GTOW CO    => "F-F-F-F-F"
    """
    if pos not in GTOW_POS_ORDER:
        raise ValueError(f"Unknown position for fold chain: {pos}")
    n = _idx(pos)
    return "-".join(["F"] * n)


def _params_base(gametype: str, depth: int, preflop_actions: str) -> Dict[str, str]:
    return {
        "gametype": gametype,
        "depth": str(depth),
        "stacks": "",
        "preflop_actions": preflop_actions,
        "flop_actions": "",
        "turn_actions": "",
        "river_actions": "",
        "board": "",
    }


def _pairings() -> List[Tuple[str, str]]:
    """
    (opener, responder) pairs matching your list.
    """
    pairs: List[Tuple[str, str]] = []
    for resp in ["LJ", "HJ", "CO", "BTN", "SB", "BB"]:
        pairs.append(("UTG", resp))
    for resp in ["HJ", "CO", "BTN", "SB", "BB"]:
        pairs.append(("LJ", resp))
    for resp in ["CO", "BTN", "SB", "BB"]:
        pairs.append(("HJ", resp))
    for resp in ["BTN", "SB", "BB"]:
        pairs.append(("CO", resp))
    for resp in ["SB", "BB"]:
        pairs.append(("BTN", resp))
    pairs.append(("SB", "BB"))
    return pairs


def _existing_outputs(out_dir: str) -> set[str]:
    if not os.path.isdir(out_dir):
        return set()
    return {fn for fn in os.listdir(out_dir) if fn.lower().endswith(".json")}


def _queue_filename(i: int, output_file: str) -> str:
    safe = output_file.replace("/", "_")
    return f"{i:03d}__{safe}.spot.json"


def _write_queue_file(queue_path: str, spot: Spot) -> None:
    os.makedirs(os.path.dirname(queue_path), exist_ok=True)
    payload = {"spots": [{"output_file": spot.output_file, "description": spot.description, "params": spot.params}]}
    with open(queue_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)
        f.write("\n")


def _make_action_line_rfi(seat: str) -> str:
    return f"{seat} folds to act -> RFI"


def _make_action_line_chain(opener: str, hero: str) -> List[Tuple[str, str]]:
    """
    Returns (filename, human readable action line) for the 5 nodes:
    - hero vs opener open (3bet decision)
    - opener vs hero 3bet (4bet decision)
    - hero vs opener 4bet (5bet decision)
    - opener vs hero 5bet (6bet jam decision)
    - hero vs opener 6bet jam (call decision)
    """
    return [
        (f"{hero}_vs_{opener}_OPEN.json", f"{opener} opens -> {hero} decision (3-bet node)"),
        (f"{opener}_vs_{hero}_3BET.json", f"{hero} 3-bets -> {opener} decision (4-bet node)"),
        (f"{hero}_vs_{opener}_4BET.json", f"{opener} 4-bets -> {hero} decision (5-bet node)"),
        (f"{opener}_vs_{hero}_5BET.json", f"{hero} 5-bets -> {opener} decision (6-bet jam node)"),
        (f"{hero}_vs_{opener}_6BET.json", f"{opener} 6-bet jams -> {hero} decision (call/fold node)"),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate offline GTOWizard fetch queue for 7-max preflop library.")
    parser.add_argument("--out-dir", default="data/import_ranges", help="Where fetched JSON files live (for duplicate checks).")
    parser.add_argument("--queue-dir", default="data/import_ranges/gtowizard_queue", help="Where to write one-spot queue files.")
    parser.add_argument("--gametype", default="Cash9m50zGeneral25Open", help="GTOW gametype query param.")
    parser.add_argument("--depth", type=int, default=100, help="Stack depth query param.")
    parser.add_argument(
        "--include-needs-discovery",
        action="store_true",
        help="Also generate queue files for non-RFI spots (will NOT work until you fill in preflop_actions). Default: only generate runnable RFI queue files.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Write queue files even if the output_file already exists in out-dir (not recommended).",
    )
    args = parser.parse_args()

    existing = _existing_outputs(args.out_dir)

    spots: List[Spot] = []

    # RFI spots
    for seat in ["UTG", "LJ", "HJ", "CO", "BTN", "SB"]:
        gtow_pos = SEAT_TO_GTOW_OPEN_POS[seat]
        pre = _fold_chain_to_pos(gtow_pos)
        output_file = f"{seat}_RFI.json"

        status = "PRESENT" if output_file in existing else "MISSING"
        if status == "PRESENT" and not args.force:
            # still include in plan, but do not queue by default
            pass

        spots.append(
            Spot(
                output_file=output_file,
                description=f"{seat} RFI (GTOW {gtow_pos}; preflop_actions={pre or '<empty>'}).",
                params=_params_base(args.gametype, args.depth, pre),
                status=status,
                action_line=_make_action_line_rfi(seat),
            )
        )

    # Interaction chains (NEEDS_DISCOVERY offline)
    for opener, hero in _pairings():
        for filename, action_line in _make_action_line_chain(opener=opener, hero=hero):
            status = "PRESENT" if filename in existing else "NEEDS_DISCOVERY"
            # Placeholder params: only folds to opener are known offline. Raise codes/sizes are unknown.
            gtow_opener = "UTG+2" if opener == "UTG" else opener
            pre_prefix = _fold_chain_to_pos(gtow_opener)
            params = _params_base(args.gametype, args.depth, pre_prefix)
            params["preflop_actions"] = f"{pre_prefix}-<OPEN>-<3B>-<4B>-<5B>-<6BJAM>" if pre_prefix else "<OPEN>-<3B>-<4B>-<5B>-<6BJAM>"

            spots.append(
                Spot(
                    output_file=filename,
                    description=action_line,
                    params=params,
                    status=status,
                    action_line=action_line,
                )
            )

    # Write plan file
    plan_path = os.path.join(args.queue_dir, "plan.json")
    os.makedirs(args.queue_dir, exist_ok=True)
    plan_obj = {
        "meta": {
            "gametype": args.gametype,
            "depth": args.depth,
            "out_dir": args.out_dir,
            "queue_dir": args.queue_dir,
            "note": "Queue files are one-spot configs for scripts/fetch_gtowizard_spot_solutions.py. Spots marked NEEDS_DISCOVERY require real preflop_actions codes/sizes.",
        },
        "spots": [
            {
                "output_file": s.output_file,
                "status": s.status,
                "description": s.description,
                "action_line": s.action_line,
                "params": s.params,
            }
            for s in spots
        ],
    }
    with open(plan_path, "w", encoding="utf-8") as f:
        json.dump(plan_obj, f, indent=4, ensure_ascii=False)
        f.write("\n")

    # Write runnable queue files (RFI only by default)
    written = 0
    for i, s in enumerate(spots, start=1):
        if s.output_file in existing and not args.force:
            continue
        if s.status == "NEEDS_DISCOVERY" and not args.include_needs_discovery:
            continue
        # Avoid writing placeholder queue entries unless explicitly requested
        if "<OPEN>" in s.params.get("preflop_actions", "") and not args.include_needs_discovery:
            continue
        qpath = os.path.join(args.queue_dir, _queue_filename(i, s.output_file))
        _write_queue_file(qpath, s)
        written += 1

    print(f"Wrote plan: {plan_path}")
    print(f"Wrote {written} queue files into: {args.queue_dir}")
    print("Run one at a time like:")
    print("  python3 scripts/fetch_gtowizard_spot_solutions.py --spots <queue-file> --out-dir data/import_ranges --min-delay 3 --max-delay 7")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


