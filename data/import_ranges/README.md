# Importing ranges into `data/gto.db`

Drop JSON exports into this folder and run:

```bash
python3 scripts/import_ranges.py
```

## Optional: fetching GTOWizard spot JSON (slow + safe)

If you want to download spot JSON directly from GTOWizard and save it into this folder (without spamming the API),
use:

```bash
export GTOWIZARD_BEARER_TOKEN='YOUR_TOKEN'
# optional:
export GTOWIZARD_CLIENT_ID='YOUR_GWCLIENTID'

python3 scripts/fetch_gtowizard_spot_solutions.py \
  --spots data/import_ranges/gtowizard_spots.example.json \
  --out-dir data/import_ranges \
  --min-delay 3.0 --max-delay 7.0
```

CoinPoker naming: by default the fetch script rewrites **`UTG+2` → `UTG`** in the downloaded JSON (and rewrites
GTOW 9-max `UTG` → `UTG_9` to avoid collisions), so your imported scenario names match your CoinPoker 7-max positions.

## Supported JSON formats

### 1) Solver “full node” export (recommended)

Must be a **single JSON object** that includes:

- `action_solutions`
- `game` (with `active_position` + `players[].chips_on_table`)
- `players_info` (containing the hero player’s `simple_hand_counters`)

This is the only format that can be mapped reliably to:

- **scenario** (`hero_pos`, `villain_pos`, `prev_action`)
- **hand frequencies** (AA/AKs/…)

### 2) Custom “history_actions” format (template)

See `example_template.json`.

## Not supported

- A **top-level JSON array** of action solutions (no `game` / no `simple_hand_counters`), because we can’t
  reconstruct scenario context or map array indices to hands.


