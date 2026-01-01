import psycopg2
import sqlite3
import os

# PT4 Default Credentials
PT4_DB_CONFIG = {
    'dbname': 'PT4 DB', 
    'user': 'postgres',
    'password': 'dbpass',
    'host': 'localhost',
    'port': '5432'
}

SQLITE_DB = 'data/gto.db'

def get_pt4_connection():
    try:
        return psycopg2.connect(**PT4_DB_CONFIG)
    except Exception as e:
        print(f"Could not connect to PT4 Postgres: {e}")
        return None

def init_sqlite_villain_table():
    """Ensures the villain_stats table exists in SQLite"""
    os.makedirs('data', exist_ok=True)
    
    conn = sqlite3.connect(SQLITE_DB)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS villain_stats (
            player_name TEXT PRIMARY KEY,
            hands INTEGER,
            vpip REAL,
            pfr REAL,
            three_bet REAL,
            wtsd REAL,
            wsd REAL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def sync_from_pt4():
    """
    1. Connect to PT4 Postgres.
    2. Aggregate stats using VERIFIED columns.
    3. Upsert into local SQLite.
    """
    init_sqlite_villain_table()
    
    pg_conn = get_pt4_connection()
    if not pg_conn:
        return {"success": False, "error": "Could not connect to PokerTracker Database. Check credentials in scripts/pt4_service.py"}

    # VERIFIED QUERY based on schema dump
    query = """
    SELECT 
        p.player_name,
        count(*) as hands,
        sum(CAST(s.flg_vpip AS INT)) as vpip_cnt,
        sum(CASE WHEN s.cnt_p_raise > 0 THEN 1 ELSE 0 END) as pfr_cnt,
        sum(CAST(s.flg_p_3bet AS INT)) as p_3bet_cnt,
        sum(CAST(s.flg_p_3bet_opp AS INT)) as p_3bet_opp_cnt,
        sum(CAST(s.flg_showdown AS INT)) as wtsd_cnt,
        sum(CASE WHEN s.flg_won_hand AND s.flg_showdown THEN 1 ELSE 0 END) as wsd_won_cnt
    FROM cash_hand_player_statistics s
    JOIN player p ON s.id_player = p.id_player
    GROUP BY p.player_name
    HAVING count(*) > 10
    """

    try:
        pg_cursor = pg_conn.cursor()
        pg_cursor.execute(query)
        rows = pg_cursor.fetchall()
        
        sqlite_conn = sqlite3.connect(SQLITE_DB)
        sq_cursor = sqlite_conn.cursor()
        
        count = 0
        for row in rows:
            name, hands, vpip_c, pfr_c, p3_c, p3_opp_c, wtsd_c, wsd_c = row
            
            # Safe calculations
            vpip = (float(vpip_c) / hands) * 100 if hands > 0 else 0
            pfr = (float(pfr_c) / hands) * 100 if hands > 0 else 0
            three_bet = (float(p3_c) / p3_opp_c) * 100 if p3_opp_c > 0 else 0
            
            # WTSD: Went to Showdown (Freq)
            wtsd_stat = (float(wtsd_c) / hands) * 100 if hands > 0 else 0
            
            # WSD: Won Showdown % (Won at SD / Went to SD)
            wsd_pct = (float(wsd_c) / wtsd_c) * 100 if wtsd_c > 0 else 0

            sq_cursor.execute('''
                INSERT INTO villain_stats (player_name, hands, vpip, pfr, three_bet, wtsd, wsd)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(player_name) DO UPDATE SET
                    hands=excluded.hands,
                    vpip=excluded.vpip,
                    pfr=excluded.pfr,
                    three_bet=excluded.three_bet,
                    wtsd=excluded.wtsd,
                    wsd=excluded.wsd,
                    updated_at=CURRENT_TIMESTAMP
            ''', (name, hands, vpip, pfr, three_bet, wtsd_stat, wsd_pct))
            count += 1

        sqlite_conn.commit()
        sqlite_conn.close()
        pg_conn.close()
        
        return {"success": True, "count": count, "message": "Successfully synced detailed player stats."}

    except Exception as e:
        error_msg = str(e)
        print(f"Sync Error: {error_msg}")
        return {"success": False, "error": error_msg}

def get_villains():
    """Fetch top villains for display"""
    init_sqlite_villain_table()
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM villain_stats ORDER BY hands DESC LIMIT 100")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def get_villain_stats(name):
    """Fetch a single villain's stats"""
    init_sqlite_villain_table()
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM villain_stats WHERE player_name = ?", (name,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None
