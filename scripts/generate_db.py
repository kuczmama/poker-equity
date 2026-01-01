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
cursor.execute('''
CREATE TABLE scenarios (
    id INTEGER PRIMARY KEY,
    variant TEXT DEFAULT 'Cash',
    table_size INTEGER DEFAULT 7,
    stack_depth INTEGER DEFAULT 100,
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

# Range Parsing Logic
ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
rank_map = {r: i for i, r in enumerate(ranks)} 

def parse_range(range_str):
    if not range_str: return set()
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
        elif len(part) >= 2: # Suited/Offsuit
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
                    # e.g. AJs+ -> AJs, AQs, AKs (decrease kicker index)
                    for k in range(idx2, idx1, -1):
                        r_kicker = ranks[k]
                        hands.add(f"{ranks[idx1]}{r_kicker}{s_type}")
                    # Also add the base hand
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

# --- SCENARIO DEFINITIONS ---
# 7-Max Positions: UTG, UTG+1, HJ, CO, BTN, SB, BB

scenarios = []

# 1. RFI Scenarios (Raise First In)
rfi_ranges = {
    'UTG': '66+,A8s+,A5s,KTs+,QTs+,JTs,ATo+,KQo',
    'UTG+1': '55+,A4s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+,QJo',
    'HJ': '44+,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,ATo+,KJo+,QJo',
    'CO': '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A9o+,KTo+,QTo+,JTo',
    'BTN': '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o,98o',
    'SB': '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,87s,76s,A7o+,K9o+,QTo+,JTo',
    'BB': '22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32+'
}

for pos, rng in rfi_ranges.items():
    scenarios.append({
        'name': f"{pos} RFI",
        'hero_pos': pos,
        'villain_pos': 'Blinds',
        'prev_action': 'Fold',
        'pot_type': 'SRP',
        'raise': rng,
        'call': ''
    })

# 2. FACING UTG OPEN (Raise 2.5)
utg_open_responses = [
    # UTG+1 vs UTG
    {'pos': 'UTG+1', '3bet': 'QQ+,AKs,AKo', 'call': 'JJ-88,AQs-AJs,KQs'},
    # HJ vs UTG
    {'pos': 'HJ', '3bet': 'QQ+,AKs,AKo', 'call': 'JJ-77,AQs-AJs,KQs,QJs'},
    # CO vs UTG
    {'pos': 'CO', '3bet': 'QQ+,AKs,AKo', 'call': 'JJ-66,AQs-AJs,KQs,QJs,JTs'},
    # BTN vs UTG
    {'pos': 'BTN', '3bet': 'QQ+,AKs,AKo', 'call': 'JJ-55,AQs-ATs,KQs-KTs,QJs-QTs,JTs,T9s,98s'},
    # SB vs UTG
    {'pos': 'SB', '3bet': 'QQ+,AKs,AKo', 'call': 'JJ-66,AQs-AJs,KQs,QJs'},
    # BB vs UTG (Defending Wide)
    {'pos': 'BB', '3bet': 'QQ+,AKs,AKo', 'call': 'JJ-22,AQs-A2s,KQs-K9s,QJs-Q9s,JTs-J8s,T9s-T8s,98s,87s,76s,65s,AJo-ATo,KQo,QJo'}
]

for resp in utg_open_responses:
    scenarios.append({
        'name': f"{resp['pos']} vs UTG Open",
        'hero_pos': resp['pos'],
        'villain_pos': 'UTG',
        'prev_action': 'Raise 2.5',
        'pot_type': 'SRP',
        'raise': resp['3bet'],
        'call': resp['call']
    })

# 3. FACING UTG+1 OPEN
utg1_open_responses = [
    {'pos': 'HJ', '3bet': 'QQ+,AKs,AKo', 'call': 'JJ-77,AQs-AJs,KQs,QJs'},
    {'pos': 'CO', '3bet': 'JJ+,AKs,AKo', 'call': 'TT-66,AQs-AJs,KQs,QJs,JTs'},
    {'pos': 'BTN', '3bet': 'JJ+,AKs,AKo,A5s', 'call': 'TT-55,AQs-ATs,KQs-KJs,QJs-QTs,JTs,T9s,98s'},
    {'pos': 'SB', '3bet': 'JJ+,AKs,AKo', 'call': 'TT-66,AQs-AJs,KQs'},
    {'pos': 'BB', '3bet': 'JJ+,AKs,AKo', 'call': 'TT-22,AQs-A2s,KQs-K8s,QJs-Q9s,JTs-J9s,T9s,98s,87s,76s,AJo,KQo'}
]

for resp in utg1_open_responses:
    scenarios.append({
        'name': f"{resp['pos']} vs UTG+1 Open",
        'hero_pos': resp['pos'],
        'villain_pos': 'UTG+1',
        'prev_action': 'Raise 2.5',
        'pot_type': 'SRP',
        'raise': resp['3bet'],
        'call': resp['call']
    })

# 4. FACING HJ OPEN
hj_open_responses = [
    {'pos': 'CO', '3bet': 'JJ+,AKs,AKo,A5s', 'call': 'TT-55,AQs-AJs,KQs,QJs,JTs'},
    {'pos': 'BTN', '3bet': 'TT+,AQs+,AKo,A5s,A4s', 'call': '99-22,AJs-A8s,KQs-KTs,QJs-QTs,JTs,T9s,98s,87s'},
    {'pos': 'SB', '3bet': 'JJ+,AQs+,AKo', 'call': 'TT-66,AQs-AJs,KQs'},
    {'pos': 'BB', '3bet': 'TT+,AQs+,AKo', 'call': '99-22,AJs-A2s,KQs-K5s,QJs-Q8s,JTs-J8s,T9s-T8s,98s,87s,76s,65s,ATo+,KJo+,QJo'}
]

for resp in hj_open_responses:
    scenarios.append({
        'name': f"{resp['pos']} vs HJ Open",
        'hero_pos': resp['pos'],
        'villain_pos': 'HJ',
        'prev_action': 'Raise 2.5',
        'pot_type': 'SRP',
        'raise': resp['3bet'],
        'call': resp['call']
    })

# 5. FACING CO OPEN
co_open_responses = [
    {'pos': 'BTN', '3bet': '99+,AJs+,AQo+,A5s,A4s', 'call': '88-22,ATs-A2s,KQs-K9s,QJs-Q9s,JTs-J9s,T9s,98s,87s,76s'},
    {'pos': 'SB', '3bet': 'TT+,AJs+,AQo+', 'call': '99-55,ATs+,KQs,QJs'},
    {'pos': 'BB', '3bet': '99+,AJs+,AQo+', 'call': '88-22,ATs-A2s,KQs-K2s,QJs-Q5s,JTs-J7s,T9s-T7s,98s,87s,76s,65s,54s,ATo+,KTo+,QTo+,JTo'}
]

for resp in co_open_responses:
    scenarios.append({
        'name': f"{resp['pos']} vs CO Open",
        'hero_pos': resp['pos'],
        'villain_pos': 'CO',
        'prev_action': 'Raise 2.5',
        'pot_type': 'SRP',
        'raise': resp['3bet'],
        'call': resp['call']
    })

# 6. FACING BTN OPEN
btn_open_responses = [
    {'pos': 'SB', '3bet': '88+,ATs+,KJs+,AJo+,KQo', 'call': ''},
    {'pos': 'BB', '3bet': '88+,AJs+,AQo+,KQs', 'call': '77-22,ATs-A2s,KJs-K2s,QJs-Q2s,JTs-J2s,T9s-T4s,98s-95s,87s-85s,76s-75s,65s,54s,AJo-A2o,KTo-K2o,QTo-Q5o,JTo-J7o'}
]

for resp in btn_open_responses:
    scenarios.append({
        'name': f"{resp['pos']} vs BTN Open",
        'hero_pos': resp['pos'],
        'villain_pos': 'BTN',
        'prev_action': 'Raise 2.5',
        'pot_type': 'SRP',
        'raise': resp['3bet'],
        'call': resp['call']
    })

# 7. FACING 3-BET (Response: Call 3-Bet or 4-Bet)
# This is "Hero Open, Villain 3-Bet, Hero Response"
vs_3bet_responses = [
    # UTG vs X 3-Bet
    {'pos': 'UTG', 'villain': 'BTN', 'raise': 'KK+,AKs,A5s', 'call': 'QQ-88,AQs-AJs,KQs'}, # 4-Bet Range
    {'pos': 'UTG', 'villain': 'BB', 'raise': 'KK+,AKs,A5s', 'call': 'QQ-88,AQs-AJs,KQs,AQo'},
    
    # CO vs X 3-Bet
    {'pos': 'CO', 'villain': 'BTN', 'raise': 'QQ+,AKs,AKo,A5s,A4s', 'call': 'JJ-77,AQs-ATs,KQs-KJs,QJs,JTs,AQo'},
    {'pos': 'CO', 'villain': 'BB', 'raise': 'JJ+,AKs,AKo,A5s,A4s', 'call': 'TT-66,AQs-ATs,KQs-KJs,QJs,JTs,AQo'},

    # BTN vs X 3-Bet
    {'pos': 'BTN', 'villain': 'SB', 'raise': 'QQ+,AKs,AKo,A5s,A4s', 'call': 'JJ-66,AQs-ATs,KQs-KTs,QJs-QTs,JTs,T9s,98s,AQo'},
    {'pos': 'BTN', 'villain': 'BB', 'raise': 'QQ+,AKs,AKo,A5s,A4s', 'call': 'JJ-66,AQs-ATs,KQs-KTs,QJs-QTs,JTs,T9s,98s,AQo'},
]

for resp in vs_3bet_responses:
    scenarios.append({
        'name': f"{resp['pos']} vs {resp['villain']} 3-Bet",
        'hero_pos': resp['pos'],
        'villain_pos': resp['villain'],
        'prev_action': 'Raise 9',
        'pot_type': '3BP',
        'raise': resp['raise'],
        'call': resp['call']
    })

# 8. FACING 4-BET (Response: Call 4-Bet or 5-Bet Shove)
# This is "Hero 3-Bet, Villain 4-Bet, Hero Response"
vs_4bet_responses = [
    # BTN vs UTG 4-Bet (Very Tight)
    # BTN 3-bet was QQ+, AK. UTG 4-bets. BTN Shoves KK+, Calls QQ, AKs? Folds AKo?
    {'pos': 'BTN', 'villain': 'UTG', 'raise': 'KK+', 'call': 'QQ,AKs'}, 
    
    # BTN vs CO 4-Bet (Standard Late Pos)
    {'pos': 'BTN', 'villain': 'CO', 'raise': 'KK+,AKs', 'call': 'TT-QQ,AKo,AQs'},
    
    # BB vs BTN 4-Bet (Polarized 3-bet -> Jam or Fold usually)
    {'pos': 'BB', 'villain': 'BTN', 'raise': 'QQ+,AKs,AKo', 'call': 'JJ-TT'},
    
    # SB vs BTN 4-Bet
    {'pos': 'SB', 'villain': 'BTN', 'raise': 'QQ+,AKs,AKo', 'call': ''}, # Often Jam or Fold OOP 100bb
    
    # CO vs UTG 4-Bet
    {'pos': 'CO', 'villain': 'UTG', 'raise': 'KK+', 'call': 'QQ,AKs'}
]

for resp in vs_4bet_responses:
    scenarios.append({
        'name': f"{resp['pos']} vs {resp['villain']} 4-Bet",
        'hero_pos': resp['pos'],
        'villain_pos': resp['villain'],
        'prev_action': 'Raise 22', # Approx 4-bet size
        'pot_type': '4BP',
        'raise': resp['raise'], # 5-Bet Shove
        'call': resp['call']   # Call 4-Bet
    })


# --- INSERTION LOGIC ---

for s in scenarios:
    cursor.execute('''
        INSERT INTO scenarios (
            variant, table_size, stack_depth, name, hero_pos, villain_pos, prev_action, pot_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', ('Cash', 7, 100, s['name'], s['hero_pos'], s['villain_pos'], s['prev_action'], s['pot_type']))
    
    scenario_id = cursor.lastrowid
    
    raise_hands = parse_range(s['raise'])
    call_hands = parse_range(s['call'])
    
    for hand in all_possible_hands:
        freqs = {}
        is_raise = hand in raise_hands
        is_call = hand in call_hands
        
        if is_raise and is_call:
            freqs = {'raise': 0.5, 'call': 0.5}
        elif is_raise:
            # For 5-bet scenarios (pot_type=4BP), raise usually means All-In
            if s['pot_type'] == '4BP':
                 freqs = {'raise_all_in': 1.0}
            else:
                 freqs = {'raise': 1.0}
        elif is_call:
            freqs = {'call': 1.0}
        else:
            freqs = {'fold': 1.0}
            
        cursor.execute('INSERT INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)',
                       (scenario_id, hand, json.dumps(freqs)))

conn.commit()
conn.close()

print(f"Database generated at {DB_FILE} with RFI, Facing Open, 3-Bet, and 4-Bet scenarios.")
