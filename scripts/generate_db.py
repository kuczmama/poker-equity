import sqlite3
import json
import os

# Database file
DB_FILE = 'data/gto.db'

# Ensure data directory exists
os.makedirs('data', exist_ok=True)

# Remove existing db
if os.path.exists(DB_FILE):
    os.remove(DB_FILE)

conn = sqlite3.connect(DB_FILE)
cursor = conn.cursor()

# Create Tables
# Added columns for game context: variant, table_size, stack_depth
cursor.execute('''
CREATE TABLE scenarios (
    id INTEGER PRIMARY KEY,
    variant TEXT DEFAULT 'Cash', -- Cash, MTT
    table_size INTEGER DEFAULT 6, -- 6, 7, 8, 9
    stack_depth INTEGER DEFAULT 100, -- BB
    name TEXT,
    hero_pos TEXT,
    villain_pos TEXT,
    prev_action TEXT,
    pot_type TEXT
);
''')

cursor.execute('''
CREATE TABLE strategies (
    scenario_id INTEGER,
    hand TEXT,
    frequencies TEXT, -- JSON string
    FOREIGN KEY(scenario_id) REFERENCES scenarios(id),
    PRIMARY KEY (scenario_id, hand)
);
''')

# Range Parsing Logic (same as before)
ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
rank_map = {r: i for i, r in enumerate(ranks)} 

def parse_range(range_str):
    hands = set()
    parts = [p.strip() for p in range_str.split(',')]
    
    for part in parts:
        if not part: continue
        
        # Handle Pairs
        if len(part) == 2 and part[0] == part[1]: 
            idx = rank_map[part[0]]
            hands.add(part)
        elif len(part) == 3 and part[2] == '+' and part[0] == part[1]:
            base_idx = rank_map[part[0]]
            for i in range(base_idx + 1):
                r = ranks[i]
                hands.add(r + r)
        elif len(part) >= 2:
            is_plus = '+' in part
            clean_part = part.replace('+', '')
            
            if len(clean_part) < 2: continue
            
            h1, h2 = clean_part[0], clean_part[1]
            if rank_map[h1] > rank_map[h2]: h1, h2 = h2, h1
            
            idx1, idx2 = rank_map[h1], rank_map[h2]
            
            has_suit = len(clean_part) == 3
            suit = clean_part[2] if has_suit else None
            
            def add_hands(s_type):
                if is_plus:
                    for k in range(idx2, idx1, -1):
                        r_kicker = ranks[k]
                        hands.add(f"{ranks[idx1]}{r_kicker}{s_type}")
                    hands.add(f"{ranks[idx1]}{ranks[idx2]}{s_type}")
                else:
                    hands.add(f"{ranks[idx1]}{ranks[idx2]}{s_type}")

            if suit:
                add_hands(suit)
            else:
                add_hands('s')
                add_hands('o')
                
    return hands

def generate_all_hands():
    all_hands = []
    for i in range(13):
        for j in range(13):
            r1 = ranks[i]
            r2 = ranks[j]
            if i == j:
                all_hands.append(f"{r1}{r2}")
            elif i < j:
                all_hands.append(f"{r1}{r2}s")
            else:
                all_hands.append(f"{r2}{r1}o")
    return all_hands

all_possible_hands = generate_all_hands()

# Initial Data (RFI Ranges)
# Updated to 7-max mappings (LJ is first, then HJ, CO, BTN, SB, BB, UTG?)
# Standard 7-handed: UTG, UTG+1, HJ, CO, BTN, SB, BB.
# User wants "UTG" as first position.
# Let's map typical ranges.

position_map = {
    'UTG': 'UTG',       # Tightest
    'UTG+1': 'UTG+1',   # 
    'HJ': 'HJ',
    'CO': 'CO',
    'BTN': 'BTN',
    'SB': 'SB',
    'BB': 'BB'
}

# Rough range estimations for 7-max 100bb (Cash)
raw_ranges = {
    'UTG': '77+,AJs+,KQs,AQo+',
    'UTG+1': '66+,ATs+,KJs+,QJs,JTs,AQo+',
    'HJ': '55+,A9s+,KTs+,QTs+,J9s+,T9s,98s,AJo+,KQo',
    'CO': '44+,A2s+,K9s+,Q9s+,J9s+,T8s+,97s+,87s,76s,ATo+,KJo+,QJo',
    'BTN': '22+,A2s+,K2s+,Q5s+,J7s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o',
    'SB': '22+,A2s+,K2s+,Q5s+,J7s+,T6s+,96s+,85s+,75s+,64s+,54s,A7o+,K9o+,QTo+,JTo+',
    'BB': '22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32+' # Check/fold range if folded to?
}

# Insert RFI Scenarios for Cash 7-max 100bb
for pos, range_str in raw_ranges.items():
    if pos not in position_map: continue
    
    scenario_name = f"{pos} RFI"
    cursor.execute('''
        INSERT INTO scenarios (
            variant, table_size, stack_depth, name, hero_pos, villain_pos, prev_action, pot_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', ('Cash', 7, 100, scenario_name, pos, 'Blinds', 'Fold', 'SRP'))
    
    scenario_id = cursor.lastrowid
    
    range_hands = parse_range(range_str)
    
    for hand in all_possible_hands:
        freqs = {}
        if hand in range_hands:
            freqs = {'raise': 1.0}
        else:
            freqs = {'fold': 1.0}
            
        cursor.execute('INSERT INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)',
                       (scenario_id, hand, json.dumps(freqs)))

conn.commit()
conn.close()

print(f"Database generated at {DB_FILE} with 7-max support")
