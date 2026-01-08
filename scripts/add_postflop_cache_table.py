#!/usr/bin/env python3
"""
Add postflop_cache table to store solved boards
"""
import sqlite3
import sys

DB_PATH = 'data/gto.db'

def add_postflop_cache_table():
    """Create postflop_cache table for caching solver results"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS postflop_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_key TEXT UNIQUE NOT NULL,
            board_cards TEXT NOT NULL,
            hero_pos TEXT NOT NULL,
            villain_pos TEXT NOT NULL,
            pot_bb REAL NOT NULL,
            stack_bb REAL NOT NULL,
            iterations INTEGER NOT NULL,
            hero_strategy TEXT NOT NULL,
            villain_strategy TEXT NOT NULL,
            exploitability REAL NOT NULL,
            compute_time_seconds REAL NOT NULL,
            hero_range_size INTEGER,
            villain_range_size INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create index on cache_key for fast lookups
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_postflop_cache_key
        ON postflop_cache(cache_key)
    """)

    conn.commit()
    conn.close()

    print("✓ Created postflop_cache table with index")

if __name__ == '__main__':
    add_postflop_cache_table()
