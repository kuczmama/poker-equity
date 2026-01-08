#!/usr/bin/env python3
"""
Postflop Solver API

On-demand postflop solving for specific board textures.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import sqlite3
import json
import hashlib
from typing import Dict, List, Tuple, Any, Optional
from scripts.cfr_solver_wrapper import run_cfr_solver, CFRResult
from scripts.cfr_range_builder import generate_all_169_hands, build_poker_solver_range

def generate_cache_key(
    board_cards: List[str],
    hero_pos: str,
    villain_pos: str,
    pot_bb: float,
    stack_bb: float,
    iterations: int
) -> str:
    """
    Generate unique cache key for a postflop solve.

    Key includes all parameters that affect the solution.
    """
    # Sort board cards for consistency (As Kh Qd == Qd Kh As)
    sorted_board = sorted(board_cards)

    # Create deterministic string representation
    key_str = f"{'-'.join(sorted_board)}|{hero_pos}|{villain_pos}|{pot_bb}|{stack_bb}|{iterations}"

    # Hash for cleaner storage
    return hashlib.sha256(key_str.encode()).hexdigest()

def get_cached_result(cache_key: str, db_path: str) -> Optional[Dict[str, Any]]:
    """
    Check if a solve result exists in cache.

    Returns:
        Cached result dict if found, None otherwise
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT board_cards, hero_pos, villain_pos, pot_bb, stack_bb,
               hero_strategy, villain_strategy, exploitability,
               compute_time_seconds, iterations, hero_range_size, villain_range_size
        FROM postflop_cache
        WHERE cache_key = ?
    """, (cache_key,))

    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    # Parse JSON strategies
    return {
        'board': json.loads(row[0]),
        'hero_pos': row[1],
        'villain_pos': row[2],
        'pot_bb': row[3],
        'stack_bb': row[4],
        'hero_strategy': json.loads(row[5]),
        'villain_strategy': json.loads(row[6]),
        'exploitability': row[7],
        'compute_time_seconds': row[8],
        'iterations': row[9],
        'hero_range_size': row[10],
        'villain_range_size': row[11],
        'cached': True  # Flag to indicate this came from cache
    }

def save_to_cache(
    cache_key: str,
    result: Dict[str, Any],
    db_path: str
) -> None:
    """
    Save solve result to cache.
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        INSERT OR REPLACE INTO postflop_cache
        (cache_key, board_cards, hero_pos, villain_pos, pot_bb, stack_bb,
         iterations, hero_strategy, villain_strategy, exploitability,
         compute_time_seconds, hero_range_size, villain_range_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        cache_key,
        json.dumps(result['board']),
        result['hero_pos'],
        result['villain_pos'],
        result['pot_bb'],
        result['stack_bb'],
        result['iterations'],
        json.dumps(result['hero_strategy']),
        json.dumps(result['villain_strategy']),
        result['exploitability'],
        result['compute_time_seconds'],
        result.get('hero_range_size'),
        result.get('villain_range_size')
    ))

    conn.commit()
    conn.close()

def card_to_solver_format(card: str) -> int:
    """
    Convert 2-character card (e.g., 'As', 'Kh') to solver integer format.

    Solver format: rank * 4 + suit
    Ranks: A=12, K=11, Q=10, J=9, T=8, 9=7, ..., 2=0
    Suits: s=0, h=1, d=2, c=3

    Args:
        card: 2-char string like 'As', 'Kh'

    Returns:
        Integer card representation
    """
    rank_map = {'A': 12, 'K': 11, 'Q': 10, 'J': 9, 'T': 8,
                '9': 7, '8': 6, '7': 5, '6': 4, '5': 3,
                '4': 2, '3': 1, '2': 0}
    suit_map = {'s': 0, 'h': 1, 'd': 2, 'c': 3}

    rank = rank_map[card[0]]
    suit = suit_map[card[1]]

    return rank * 4 + suit

def get_preflop_ranges_from_db(
    db_path: str,
    hero_pos: str,
    villain_pos: str,
    scenario_name: str
) -> Tuple[List[str], List[float], List[str], List[float]]:
    """
    Query database for preflop ranges from completed scenarios.

    Args:
        db_path: Path to SQLite database
        hero_pos: Hero position (e.g., 'BB', 'BTN')
        villain_pos: Villain position (e.g., 'UTG', 'CO')
        scenario_name: Scenario to query (e.g., 'BB vs UTG Open')

    Returns:
        Tuple of (hero_hands, hero_weights, villain_hands, villain_weights)
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get hero scenario (e.g., BB vs UTG Open)
    cursor.execute("""
        SELECT id FROM scenarios
        WHERE hero_pos = ? AND villain_pos = ? AND name LIKE ?
        ORDER BY variant DESC
        LIMIT 1
    """, (hero_pos, villain_pos, f"%{scenario_name}%"))

    hero_scenario = cursor.fetchone()
    if not hero_scenario:
        # Fallback: use all 169 hands with equal weights
        print(f"Warning: No preflop scenario found for {hero_pos} vs {villain_pos}")
        all_hands = generate_all_169_hands()
        uniform_weights = [1.0 / len(all_hands)] * len(all_hands)
        conn.close()
        return all_hands, uniform_weights, all_hands, uniform_weights

    hero_scenario_id = hero_scenario[0]

    # Get hero range from strategies
    cursor.execute("""
        SELECT hand, ("call" + "raise" + "raise_all_in") as total_freq
        FROM strategies
        WHERE scenario_id = ?
        AND ("call" + "raise" + "raise_all_in") > 0
    """, (hero_scenario_id,))

    hero_range = {}
    for row in cursor.fetchall():
        hand, freq = row
        if freq > 0:
            hero_range[hand] = freq

    # Normalize hero range
    total = sum(hero_range.values())
    if total > 0:
        hero_hands = list(hero_range.keys())
        hero_weights = [hero_range[h] / total for h in hero_hands]
    else:
        # Fallback
        hero_hands = generate_all_169_hands()
        hero_weights = [1.0 / len(hero_hands)] * len(hero_hands)

    # Get villain opening range
    cursor.execute("""
        SELECT id FROM scenarios
        WHERE hero_pos = ? AND name LIKE '%RFI%'
        ORDER BY variant DESC
        LIMIT 1
    """, (villain_pos,))

    villain_scenario = cursor.fetchone()
    if villain_scenario:
        villain_scenario_id = villain_scenario[0]

        cursor.execute("""
            SELECT hand, ("raise" + "raise_all_in") as total_freq
            FROM strategies
            WHERE scenario_id = ?
            AND ("raise" + "raise_all_in") > 0
        """, (villain_scenario_id,))

        villain_range = {}
        for row in cursor.fetchall():
            hand, freq = row
            if freq > 0:
                villain_range[hand] = freq

        total = sum(villain_range.values())
        if total > 0:
            villain_hands = list(villain_range.keys())
            villain_weights = [villain_range[h] / total for h in villain_hands]
        else:
            villain_hands = generate_all_169_hands()
            villain_weights = [1.0 / len(villain_hands)] * len(villain_hands)
    else:
        villain_hands = generate_all_169_hands()
        villain_weights = [1.0 / len(villain_hands)] * len(villain_hands)

    conn.close()
    return hero_hands, hero_weights, villain_hands, villain_weights

def solve_postflop_board(
    board_cards: List[str],
    hero_pos: str,
    villain_pos: str,
    pot_bb: float = 10.0,
    stack_bb: float = 90.0,
    iterations: int = 5000,
    db_path: str = 'data/gto.db',
    use_cache: bool = True
) -> Dict[str, Any]:
    """
    Solve a postflop board on-demand with caching.

    Args:
        board_cards: List of board cards (e.g., ['As', 'Kh', 'Qd'] for flop)
        hero_pos: Hero position
        villain_pos: Villain position
        pot_bb: Current pot size in big blinds
        stack_bb: Remaining stack in big blinds
        iterations: CFR iterations (default 5000 for speed)
        db_path: Path to database with preflop ranges
        use_cache: Check cache before solving (default True)

    Returns:
        Dictionary with hero/villain strategies and metadata
    """
    # Generate cache key
    cache_key = generate_cache_key(board_cards, hero_pos, villain_pos, pot_bb, stack_bb, iterations)

    # Check cache first
    if use_cache:
        cached_result = get_cached_result(cache_key, db_path)
        if cached_result:
            print(f"✓ Cache hit! Board: {board_cards} (saved {cached_result['compute_time_seconds']:.1f}s)")
            return cached_result

    # Board cards should be kept as strings (e.g., ["As", "Kh", "Qd"])
    # The solver expects string format, not integers

    # Get preflop ranges from database
    scenario_name = "Open" if len(board_cards) == 3 else "Open"  # For now, use opening scenario
    hero_hands, hero_weights, villain_hands, villain_weights = get_preflop_ranges_from_db(
        db_path, hero_pos, villain_pos, scenario_name
    )

    # Build solver ranges
    hero_combos, hero_combo_weights = build_poker_solver_range(hero_hands, hero_weights)
    villain_combos, villain_combo_weights = build_poker_solver_range(villain_hands, villain_weights)

    # Remove combos that conflict with board
    board_set = set(board_cards)  # Board is already strings like ["As", "Kh", "Qd"]

    def filter_combos(combos, weights):
        filtered_combos = []
        filtered_weights = []
        for combo, weight in zip(combos, weights):
            # Combo format: "AsAh" (4 characters: rank+suit+rank+suit)
            # Split into individual cards
            card1 = combo[0:2]  # First 2 chars: "As"
            card2 = combo[2:4]  # Next 2 chars: "Ah"

            # Check if either card is on the board
            if card1 not in board_set and card2 not in board_set:
                filtered_combos.append(combo)
                filtered_weights.append(weight)

        # Renormalize weights
        total = sum(filtered_weights)
        if total > 0:
            filtered_weights = [w / total for w in filtered_weights]

        return filtered_combos, filtered_weights

    hero_combos, hero_combo_weights = filter_combos(hero_combos, hero_combo_weights)
    villain_combos, villain_combo_weights = filter_combos(villain_combos, villain_combo_weights)

    # Generate solver config
    chip_scale = 100
    config = {
        "board": board_cards,  # Keep as strings: ["As", "Kh", "Qd"]
        "pot": int(pot_bb * chip_scale),
        "stack": int(stack_bb * chip_scale),
        "bet_sizes": [0.33, 0.5, 0.75, 1.0],  # Postflop bet sizes
        "include_all_in": True,
        "max_raises": 3,
        "initial_contrib0": 0,
        "initial_contrib1": 0,
        "players": [
            {
                "hands": hero_combos,
                "weights": hero_combo_weights
            },
            {
                "hands": villain_combos,
                "weights": villain_combo_weights
            }
        ]
    }

    print(f"Solving {len(board_cards)}-card board: {board_cards}")
    print(f"  Hero ({hero_pos}): {len(hero_combos)} combos")
    print(f"  Villain ({villain_pos}): {len(villain_combos)} combos")
    print(f"  Pot: {pot_bb}bb, Stack: {stack_bb}bb")

    # Run CFR solver
    result = run_cfr_solver(
        config=config,
        algorithm='cfr+',
        iterations=iterations
    )

    # Mark hands not in range as 'out_of_range' for UI display
    all_hands = generate_all_169_hands()
    hero_hands_set = set(hero_hands)

    # Add out_of_range entries for hands not in the preflop range
    for hand in all_hands:
        if hand not in hero_hands_set and hand not in result.hero_strategy:
            result.hero_strategy[hand] = {'out_of_range': 1.0}

    # Prepare result dict
    solve_result = {
        'board': board_cards,
        'hero_pos': hero_pos,
        'villain_pos': villain_pos,
        'hero_strategy': result.hero_strategy,
        'villain_strategy': result.villain_strategy,
        'exploitability': result.exploitability,
        'iterations': result.iterations,
        'compute_time_seconds': result.compute_time_seconds,
        'pot_bb': pot_bb,
        'stack_bb': stack_bb,
        'hero_range_size': len(hero_hands),
        'villain_range_size': len(villain_hands),
        'cached': False
    }

    # Save to cache for future use
    if use_cache:
        save_to_cache(cache_key, solve_result, db_path)
        print(f"✓ Saved to cache: {cache_key[:8]}...")

    return solve_result

if __name__ == '__main__':
    # Test
    result = solve_postflop_board(
        board_cards=['As', 'Kh', 'Qd'],
        hero_pos='BB',
        villain_pos='BTN',
        iterations=1000
    )

    print("\n=== RESULTS ===")
    print(f"Exploitability: {result['exploitability']:.6f}%")
    print(f"Compute time: {result['compute_time_seconds']:.2f}s")
    print(f"\nHero strategy (first 5 hands):")
    for i, (hand, actions) in enumerate(list(result['hero_strategy'].items())[:5]):
        print(f"  {hand}: {actions}")
