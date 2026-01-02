# Importing ranges into `data/gto.db`

Drop JSON exports into this folder and run:

```bash
python3 scripts/import_ranges.py
```

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


