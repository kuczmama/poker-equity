#!/usr/bin/env python3
"""
Preflop CFR Solver - Python Wrapper

Wraps the C++ preflop_cfr solver and provides database integration.
"""

import subprocess
import json
import sqlite3
import os
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# Path to C++ solver binary
SOLVER_BINARY = Path(__file__).parent.parent / "cpp_solver" / "preflop_cfr"
DB_FILE = Path(__file__).parent.parent / "data" / "gto.db"

# Position definitions
POSITIONS = ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"]


def run_solver(scenario: str, hero: str, villain: str = "",
               iterations: int = 10000, verbose: bool = True) -> Dict:
    """
    Run the C++ preflop solver.

    Args:
        scenario: "rfi", "facing_open", or "facing_3bet"
        hero: Hero position
        villain: Villain position (for facing_open/facing_3bet)
        iterations: Number of CFR iterations
        verbose: Print progress

    Returns:
        Parsed JSON result from solver
    """
    if not SOLVER_BINARY.exists():
        raise FileNotFoundError(f"Solver binary not found: {SOLVER_BINARY}")

    cmd = [
        str(SOLVER_BINARY),
        "--scenario", scenario,
        "--hero", hero,
        "--iterations", str(iterations)
    ]

    if villain:
        cmd.extend(["--villain", villain])

    if not verbose:
        cmd.append("--quiet")

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"Solver failed: {result.stderr}")

    # Parse JSON from stdout
    return json.loads(result.stdout)


def get_prev_action(scenario: str) -> str:
    """Get the prev_action string for database."""
    if scenario == "rfi":
        return "Fold"
    elif scenario == "facing_open":
        return "Raise 2.5"
    elif scenario == "facing_3bet":
        return "Raise 7.5"
    return "Fold"


def save_to_database(result: Dict, db_path: Path = DB_FILE):
    """
    Save solver results to the database.

    Args:
        result: Parsed solver output
        db_path: Path to SQLite database
    """
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    scenario_info = result["scenario"]
    hero_pos = scenario_info["hero_pos"]
    villain_pos = scenario_info["villain_pos"]
    scenario_type = scenario_info["type"].lower()

    prev_action = get_prev_action(scenario_type)

    # Determine pot_type
    if scenario_type == "rfi":
        pot_type = "RFI"
    elif scenario_type == "facing_open":
        pot_type = "SRP"
    else:
        pot_type = "3BP"

    # Map hero position for database (UTG -> UTG+2 for consistency)
    db_hero = "UTG+2" if hero_pos == "UTG" else hero_pos

    scenario_name = f"{hero_pos} vs {villain_pos}" if villain_pos != "Blinds" else f"{hero_pos} RFI"

    # Check if scenario exists
    cursor.execute("""
        SELECT id FROM scenarios
        WHERE hero_pos = ? AND villain_pos = ? AND prev_action = ? AND variant = 'Computed'
    """, (db_hero, villain_pos, prev_action))

    row = cursor.fetchone()
    if row:
        scenario_id = row[0]
    else:
        # Insert new scenario
        cursor.execute("""
            INSERT INTO scenarios (variant, table_size, stack_depth, name, hero_pos, villain_pos, prev_action, pot_type)
            VALUES ('Computed', 7, 100, ?, ?, ?, ?, ?)
        """, (scenario_name, db_hero, villain_pos, prev_action, pot_type))
        scenario_id = cursor.lastrowid

    # Delete old strategies
    cursor.execute("DELETE FROM strategies WHERE scenario_id = ?", (scenario_id,))

    # Insert new strategies
    strategy = result["strategy"]
    for hand, actions in strategy.items():
        # Normalize frequencies
        total = sum(actions.values())
        if total > 0:
            normalized = {a: f / total for a, f in actions.items()}
        else:
            normalized = actions

        cursor.execute("""
            INSERT INTO strategies (scenario_id, hand, frequencies)
            VALUES (?, ?, ?)
        """, (scenario_id, hand, json.dumps(normalized)))

    conn.commit()
    conn.close()

    return scenario_id


def compute_rfi_scenarios(iterations: int = 10000, verbose: bool = True):
    """Compute all RFI scenarios."""
    # RFI positions (BB can't RFI)
    rfi_positions = ["UTG", "LJ", "HJ", "CO", "BTN", "SB"]

    for pos in rfi_positions:
        if verbose:
            print(f"\n{'='*60}")
            print(f"Computing {pos} RFI")
            print(f"{'='*60}")

        result = run_solver("rfi", pos, iterations=iterations, verbose=verbose)
        scenario_id = save_to_database(result)

        if verbose:
            print(f"Saved as scenario_id={scenario_id}")


def compute_facing_open_scenarios(iterations: int = 10000, verbose: bool = True):
    """Compute all facing-open scenarios."""
    # For each opener, compute responses from later positions
    openers = ["UTG", "LJ", "HJ", "CO", "BTN", "SB"]

    for opener_idx, opener in enumerate(openers):
        # Positions that can face the open
        responders = POSITIONS[opener_idx + 1:]

        for responder in responders:
            if verbose:
                print(f"\n{'='*60}")
                print(f"Computing {responder} vs {opener} Open")
                print(f"{'='*60}")

            result = run_solver("facing_open", responder, opener,
                              iterations=iterations, verbose=verbose)
            scenario_id = save_to_database(result)

            if verbose:
                print(f"Saved as scenario_id={scenario_id}")


def compute_facing_3bet_scenarios(iterations: int = 10000, verbose: bool = True):
    """Compute facing-3bet scenarios (opener vs 3-bettor)."""
    # Common 3-bet spots
    scenarios = [
        ("UTG", "BTN"), ("UTG", "BB"),
        ("LJ", "BTN"), ("LJ", "BB"),
        ("HJ", "BTN"), ("HJ", "BB"),
        ("CO", "BTN"), ("CO", "BB"),
        ("BTN", "SB"), ("BTN", "BB"),
        ("SB", "BB"),
    ]

    for opener, threebettor in scenarios:
        if verbose:
            print(f"\n{'='*60}")
            print(f"Computing {opener} vs {threebettor} 3-Bet")
            print(f"{'='*60}")

        result = run_solver("facing_3bet", opener, threebettor,
                          iterations=iterations, verbose=verbose)
        scenario_id = save_to_database(result)

        if verbose:
            print(f"Saved as scenario_id={scenario_id}")


def compute_all(iterations: int = 10000, verbose: bool = True):
    """Compute all preflop scenarios."""
    print("=" * 60)
    print("PREFLOP CFR SOLVER")
    print("=" * 60)
    print(f"Iterations: {iterations}")
    print(f"Database: {DB_FILE}")

    print("\n[1/3] RFI Scenarios")
    compute_rfi_scenarios(iterations, verbose)

    print("\n[2/3] Facing Open Scenarios")
    compute_facing_open_scenarios(iterations, verbose)

    print("\n[3/3] Facing 3-Bet Scenarios")
    compute_facing_3bet_scenarios(iterations, verbose)

    print("\n" + "=" * 60)
    print("COMPUTATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Preflop CFR Solver")
    parser.add_argument("--iterations", "-i", type=int, default=10000,
                       help="Number of CFR iterations (default: 10000)")
    parser.add_argument("--scenario", "-s", choices=["all", "rfi", "open", "3bet"],
                       default="all", help="Which scenarios to compute")
    parser.add_argument("--quiet", "-q", action="store_true",
                       help="Suppress progress output")

    args = parser.parse_args()
    verbose = not args.quiet

    if args.scenario == "all":
        compute_all(args.iterations, verbose)
    elif args.scenario == "rfi":
        compute_rfi_scenarios(args.iterations, verbose)
    elif args.scenario == "open":
        compute_facing_open_scenarios(args.iterations, verbose)
    elif args.scenario == "3bet":
        compute_facing_3bet_scenarios(args.iterations, verbose)
