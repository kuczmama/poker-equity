import json
import sqlite3
import glob
import os
import sys

# Add parent dir to path to import anything if needed, though we use standalone logic here
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB_FILE = 'data/gto.db'

def get_db():
    return sqlite3.connect(DB_FILE)

def parse_action_str(action_obj):
    """
    Maps JSON action definition to the string format used in the DB/Frontend.
    e.g. {type: 'RAISE', betsize: '2.500'} -> 'Raise 2.5'
    """
    if not action_obj: return 'Check'
    
    atype = action_obj.get('type', '').upper()
    
    if atype == 'FOLD': return 'Fold'
    if atype == 'CALL': return 'Call'
    if atype == 'CHECK': return 'Check'
    if atype == 'RAISE' or atype == 'ALLIN':
        amt = action_obj.get('betsize', '0')
        try:
            amt_float = float(amt)
            # Remove trailing decimal if integer
            if amt_float.is_integer():
                amt_str = str(int(amt_float))
            else:
                amt_str = str(amt_float)
            
            if action_obj.get('allin'):
                return f"Allin {amt_str}"
            return f"Raise {amt_str}"
        except:
            return f"Raise {amt}"
            
    return 'Check'

def parse_solver_json(data, conn, cursor, source_file=None):
    """
    Parses 'action_solutions' format (GTO Wizard/Solver export).
    """
    game = data.get('game', {})
    if not game:
        print("  Skipping: No game data found.")
        return 0

    hero_pos = game.get('active_position')
    
    # 1. Determine Hero Position
    if not hero_pos:
        # Try finding player with is_hero=True or is_active=True
        # BUT prioritize checking 'players_info' first as it contains the strategy
        p_info = data.get('players_info', [])
        for p in p_info:
            if p.get('player', {}).get('is_hero'):
                hero_pos = p['player']['position']
                break
        
        if not hero_pos:
            players = game.get('players', [])
            for p in players:
                if p.get('is_hero'): hero_pos = p.get('position')
            
            if not hero_pos:
                for p in players:
                    if p.get('is_active') and not p.get('is_folded'):
                        hero_pos = p.get('position')
    
    if not hero_pos:
        print("  Skipping: Could not identify Hero Position.")
        return 0

    # 2. Determine Scenario Context
    # Find the aggressor (Villain) by looking at chips on table
    villain_pos = 'Blinds'
    prev_action = 'Fold'
    pot_type = 'SRP'
    
    players = game.get('players', [])
    
    max_chips = 0.0
    aggressor = None
    
    for p in players:
        if p['position'] == hero_pos: continue # Ignore Hero for determining who we are facing
        
        try:
            chips = float(p.get('chips_on_table', 0))
        except:
            chips = 0
            
        if chips > max_chips:
            max_chips = chips
            aggressor = p

    # Heuristic for scenario
    if max_chips <= 1.0:
        # Just blinds posted. RFI Scenario.
        villain_pos = 'Blinds'
        prev_action = 'Fold'
        pot_type = 'SRP'
    else:
        # Facing a Raise/Limp
        villain_pos = aggressor.get('position', 'Unknown')
        
        # Determine action string
        if float(max_chips).is_integer():
            amt_str = str(int(max_chips))
        else:
            amt_str = str(max_chips)
            
        prev_action = f"Raise {amt_str}"
        
        # Simple pot type logic
        if max_chips < 5: pot_type = 'SRP'
        elif max_chips < 15: pot_type = '3BP'
        else: pot_type = '4BP'

    # Construct Scenario Name
    scenario_name = f"{hero_pos} vs {villain_pos} ({prev_action})"
    if prev_action == 'Fold':
        scenario_name = f"{hero_pos} RFI"
    
    label = os.path.basename(source_file) if source_file else "solver.json"
    print(f"  [{label}] Detected: Hero={hero_pos}, MaxChips={max_chips}, Aggressor={aggressor.get('position') if aggressor else 'None'}")
    print(f"  -> Importing as: {scenario_name}")

    # Insert Scenario
    cursor.execute('SELECT id FROM scenarios WHERE hero_pos=? AND villain_pos=? AND prev_action=?', 
                   (hero_pos, villain_pos, prev_action))
    row = cursor.fetchone()
    
    if row:
        scenario_id = row[0]
    else:
        cursor.execute('''
            INSERT INTO scenarios (variant, table_size, stack_depth, name, hero_pos, villain_pos, prev_action, pot_type)
            VALUES ('Cash', 7, 100, ?, ?, ?, ?, ?)
        ''', (scenario_name, hero_pos, villain_pos, prev_action, pot_type))
        scenario_id = cursor.lastrowid

    # 3. Parse Strategy from simple_hand_counters
    # Locate the hero's info in players_info
    counters = {}
    p_infos = data.get('players_info', [])
    for info in p_infos:
        p_data = info.get('player', {})
        if p_data.get('position') == hero_pos:
            counters = info.get('simple_hand_counters', {})
            break
            
    if not counters:
        # Fallback to finding simple_hand_counters at root if single player export
        counters = data.get('simple_hand_counters', {})

    if not counters:
        print("  Warning: No simple_hand_counters found for Hero.")
        return 0

    # Overwrite Strategy
    cursor.execute('DELETE FROM strategies WHERE scenario_id=?', (scenario_id,))
    
    # Map solver action codes (F, C, R7.5) to DB codes (fold, call, raise)
    # The 'action_solutions' list contains the mapping
    action_map = {} # Code -> DB Key
    for sol in data.get('action_solutions', []):
        code = sol['action']['code']
        atype = sol['action']['type'].upper()
        
        if atype == 'FOLD': action_map[code] = 'fold'
        elif atype == 'CALL': action_map[code] = 'call'
        elif atype == 'RAISE':
            if sol['action'].get('allin'):
                action_map[code] = 'raise_all_in'
            else:
                action_map[code] = 'raise'
        elif atype == 'ALLIN': action_map[code] = 'raise_all_in'
    
    for hand, details in counters.items():
        solver_freqs = details.get('actions_total_frequencies', {})
        
        # Convert to DB format
        db_freqs = {}
        for code, freq in solver_freqs.items():
            if freq > 0.001:
                db_key = action_map.get(code, 'fold') # Default to fold if unknown
                
                # Handling multiple Raises (Raise Small, Raise Big)
                # If 'raise' key already exists, we might overwrite or sum.
                # Since our UI mainly supports ONE raise + All-In, 
                # we should probably map the LARGEST non-allin raise to 'raise'? 
                # Or just sum them. Let's sum them for now to show Total Raise Freq.
                # Note: This loses sizing info but fits the current schema.
                
                db_freqs[db_key] = db_freqs.get(db_key, 0) + freq
        
        if db_freqs:
            cursor.execute('INSERT INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)',
                           (scenario_id, hand, json.dumps(db_freqs)))

    return 1

def import_files():
    if not os.path.exists('data/import_ranges'):
        print("Directory data/import_ranges/ does not exist.")
        return

    files = glob.glob('data/import_ranges/*.json')
    if not files:
        print("No .json files found in data/import_ranges/")
        return

    print(f"Found {len(files)} files to import.")
    
    conn = get_db()
    cursor = conn.cursor()

    total_scenarios = 0
    
    for fpath in files:
        print(f"Processing {fpath}...")
        try:
            with open(fpath, 'r') as f:
                data = json.load(f)
        except Exception as e:
            print(f"Error reading {fpath}: {e}")
            continue

        # Some exports are a top-level list (e.g. action_solutions only)
        if isinstance(data, list):
            # This format is not importable into our DB without game context + hand mapping.
            # We fail fast with a clear message (and continue other files).
            print(f"  Skipping {os.path.basename(fpath)}: top-level JSON array detected.")
            print("  Reason: missing game context (hero/villain/prev_action) and hand mapping (simple_hand_counters).")
            print("  Fix: export the full node JSON that includes 'game' + 'players_info' (with 'simple_hand_counters').")
            continue
        if not isinstance(data, dict):
            raise TypeError(f"Unsupported JSON root type: {type(data).__name__} in {fpath}")
        
        # Detect Format
        # Format 1: Solver Export (has action_solutions)
        if 'action_solutions' in data:
            total_scenarios += parse_solver_json(data, conn, cursor, fpath)
            continue

        # Format 2: Simple Chain (has history_actions)
        history = data.get('history_actions', [])
        processed_actions = [] # List of {pos, action_str}
        
        for i, step in enumerate(history):
            # 1. Determine Context (Hero, Villain, PrevAction)
            game = step.get('game', {})
            
            # Determine Hero (Active Player)
            hero_pos = game.get('active_position')
            # Fallback if active_position missing
            if not hero_pos and 'players' in game:
                for p in game['players']:
                    if p.get('is_active') and not p.get('is_folded') and p.get('position') == game.get('active_position'):
                        hero_pos = p['position']
                        break

            if not hero_pos:
                # Try to infer from available actions
                actions = step.get('available_actions', [])
                if actions and actions[0].get('action'):
                    hero_pos = actions[0]['action'].get('position')
            
            if not hero_pos:
                print(f"  Skipping step {i}: Could not determine active position.")
                continue

            # Determine Context based on history (processed_actions)
            villain_pos = 'Blinds'
            prev_action = 'Fold'
            pot_type = 'SRP'
            
            # Find last aggressor
            aggressor = None
            raise_count = 0
            
            # We iterate backwards through history
            for prev in reversed(processed_actions):
                act = prev['action']
                if 'Raise' in act or 'Allin' in act:
                    if not aggressor: aggressor = prev
                    raise_count += 1
            
            if aggressor:
                villain_pos = aggressor['pos']
                prev_action = aggressor['action']
            
            # Pot Type Heuristic
            if raise_count == 0: pot_type = 'SRP' # RFI
            elif raise_count == 1: pot_type = 'SRP' # Facing Open
            elif raise_count == 2: pot_type = '3BP'
            elif raise_count >= 3: pot_type = '4BP'

            # 2. Check for Strategy to Import
            strategy = step.get('strategy')
            
            if strategy:
                # Construct Scenario Name
                scenario_name = f"{hero_pos} vs {villain_pos} ({prev_action})"
                if prev_action == 'Fold':
                    scenario_name = f"{hero_pos} RFI"
                
                print(f"  Importing: {scenario_name}")
                
                # Check/Create Scenario
                cursor.execute('SELECT id FROM scenarios WHERE hero_pos=? AND villain_pos=? AND prev_action=?', 
                               (hero_pos, villain_pos, prev_action))
                row = cursor.fetchone()
                
                if row:
                    scenario_id = row[0]
                else:
                    cursor.execute('''
                        INSERT INTO scenarios (variant, table_size, stack_depth, name, hero_pos, villain_pos, prev_action, pot_type)
                        VALUES ('Cash', 7, 100, ?, ?, ?, ?, ?)
                    ''', (scenario_name, hero_pos, villain_pos, prev_action, pot_type))
                    scenario_id = cursor.lastrowid
                
                # Overwrite Strategy
                cursor.execute('DELETE FROM strategies WHERE scenario_id=?', (scenario_id,))
                
                for hand, freqs in strategy.items():
                    # Ensure freqs is valid JSON-able dict
                    cursor.execute('INSERT INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)',
                                   (scenario_id, hand, json.dumps(freqs)))
                
                total_scenarios += 1
            
            # 3. Advance History
            # Find which action was selected to simulate the game flow
            selected_action_obj = None
            for item in step.get('available_actions', []):
                if item.get('selected'):
                    selected_action_obj = item.get('action')
                    break
            
            if selected_action_obj:
                action_str = parse_action_str(selected_action_obj)
                processed_actions.append({
                    'pos': hero_pos,
                    'action': action_str
                })
            else:
                pass

    conn.commit()
    conn.close()
    print(f"Done. Imported {total_scenarios} scenarios.")

if __name__ == '__main__':
    import_files()
