#!/usr/bin/env python3
"""
Cleanup Duplicate Scenarios from GTO Database

Identifies and removes scenarios where multiple positions have identical strategies
(indicating corrupted/duplicated import data).

Usage:
    python3 scripts/cleanup_duplicate_scenarios.py --dry-run  # Preview what will be deleted
    python3 scripts/cleanup_duplicate_scenarios.py            # Execute deletion
"""
import sqlite3
import argparse
from collections import defaultdict

DB_FILE = 'data/gto.db'

# Scenarios that can be computed with CFR (from cfr_scenarios.py)
CFR_COMPUTABLE_ACTIONS = {'Fold', 'Raise 2.5', 'Raise 7.5'}


def get_duplicate_scenarios(conn: sqlite3.Connection) -> list:
    """
    Find all duplicate Cash scenarios.

    A scenario is considered duplicate if it has the exact same strategy
    as ANY other scenario (regardless of hero/villain combination).
    This catches cases where the same data was imported for multiple matchups.
    The scenario with the lowest ID is kept as the 'original'.

    Returns list of tuples: (id, hero_pos, villain_pos, prev_action, original_id, original_hero, original_villain)
    """
    cursor = conn.cursor()

    query = """
    WITH strategy_hashes AS (
        SELECT
            s.id,
            s.hero_pos,
            s.villain_pos,
            s.prev_action,
            s.variant,
            GROUP_CONCAT(st.hand || ':' || st.frequencies, '|') as strat_hash
        FROM scenarios s
        JOIN strategies st ON s.id = st.scenario_id
        WHERE s.variant = 'Cash'
        GROUP BY s.id
    ),
    originals AS (
        SELECT MIN(id) as original_id, strat_hash
        FROM strategy_hashes
        GROUP BY strat_hash
        HAVING COUNT(*) > 1
    )
    SELECT sh.id, sh.hero_pos, sh.villain_pos, sh.prev_action,
           o.original_id,
           (SELECT hero_pos FROM scenarios WHERE id = o.original_id) as original_hero,
           (SELECT villain_pos FROM scenarios WHERE id = o.original_id) as original_villain
    FROM strategy_hashes sh
    JOIN originals o ON sh.strat_hash = o.strat_hash
    WHERE sh.id <> o.original_id
    ORDER BY sh.hero_pos, sh.prev_action, sh.villain_pos
    """

    cursor.execute(query)
    return cursor.fetchall()


def delete_scenario(conn: sqlite3.Connection, scenario_id: int):
    """Delete a scenario and its strategies."""
    cursor = conn.cursor()
    cursor.execute("DELETE FROM strategies WHERE scenario_id = ?", (scenario_id,))
    cursor.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))


def main():
    parser = argparse.ArgumentParser(
        description='Clean up duplicate scenarios from GTO database'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview deletions without executing'
    )
    parser.add_argument(
        '--db',
        default=DB_FILE,
        help=f'Database file path (default: {DB_FILE})'
    )
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)

    print("=" * 70)
    print("GTO DATABASE DUPLICATE CLEANUP")
    print("=" * 70)

    duplicates = get_duplicate_scenarios(conn)

    if not duplicates:
        print("\nNo duplicate scenarios found. Database is clean.")
        conn.close()
        return 0

    print(f"\nFound {len(duplicates)} duplicate scenarios to delete:\n")

    # Group by hero_pos for cleaner output
    by_hero = defaultdict(list)
    for dup in duplicates:
        scenario_id, hero_pos, villain_pos, prev_action, original_id, original_hero, original_villain = dup
        by_hero[hero_pos].append((scenario_id, villain_pos, prev_action, original_hero, original_villain))

    cfr_computable = []
    not_cfr_computable = []

    for hero_pos, dups in sorted(by_hero.items()):
        print(f"{hero_pos}:")
        for scenario_id, villain_pos, prev_action, original_hero, original_villain in dups:
            print(f"  - ID {scenario_id}: vs {villain_pos} {prev_action} (dup of {original_hero} vs {original_villain})")

            # Track which can be recomputed
            if prev_action in CFR_COMPUTABLE_ACTIONS:
                cfr_computable.append((scenario_id, hero_pos, villain_pos, prev_action))
            else:
                not_cfr_computable.append((scenario_id, hero_pos, villain_pos, prev_action))
        print()

    # Summary
    print("-" * 70)
    print(f"Total duplicates: {len(duplicates)}")
    print(f"  - CFR computable (Raise 2.5, Raise 7.5, Fold): {len(cfr_computable)}")
    print(f"  - Not CFR computable (other sizes): {len(not_cfr_computable)}")

    if not_cfr_computable:
        print("\nScenarios NOT computable with CFR (would need GTO Wizard re-download):")
        for _, hero_pos, villain_pos, prev_action in not_cfr_computable:
            print(f"  - {hero_pos} vs {villain_pos} ({prev_action})")

    if args.dry_run:
        print("\n[DRY RUN] No changes made. Run without --dry-run to delete.")
    else:
        print(f"\nDeleting {len(duplicates)} scenarios...")
        for dup in duplicates:
            scenario_id = dup[0]
            delete_scenario(conn, scenario_id)
        conn.commit()
        print("Done. Duplicate scenarios deleted.")

        print("\nTo recompute CFR scenarios, run:")
        print("  python3 scripts/compute_cfr_strategies.py --filter open --iterations 10000")

    conn.close()
    return 0


if __name__ == '__main__':
    exit(main())
