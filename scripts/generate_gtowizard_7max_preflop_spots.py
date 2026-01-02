#!/usr/bin/env python3
"""
Generate a complete 7-max preflop spot list (up to 6-bet jam/call) by *discovering* GTOWizard action codes.

Why this exists:
- `preflop_actions` uses action codes like F, C, R2.5, R12, RAI (all-in).
- 3bet/4bet/5bet sizes (and their codes) can vary by position/game type.
- So we discover them by fetching each node and reading `action_solutions`.

This script DOES make network requests when run.
You asked not to run anything yet — this file is just the tooling.

Usage (later):
  export GTOWIZARD_BEARER_TOKEN='...'
  export GTOWIZARD_CLIENT_ID='...'  # optional

  python3 scripts/generate_gtowizard_7max_preflop_spots.py \
    --gametype Cash9m50zGeneral25Open \
    --depth 100 \
    --out-spots data/import_ranges/gtowizard_spots.7max.preflop.json \
    --min-delay 3 --max-delay 7

Notes:
- This script makes GTOWizard requests (slow + rate-limited). If you see HTTP 401, your token is invalid/expired:
  refresh `GTOWIZARD_BEARER_TOKEN` and rerun with `--resume` to continue without repeating requests.
- It checkpoints progress to `<out-spots>.checkpoint.json` and updates `<out-spots>` incrementally.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_BASE_URL = "https://api.gtowizard.com/v4/solutions/spot-solution/"


class FetchError(RuntimeError):
    pass


GTOW_POS_ORDER = ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]

# Your 7-max library seats:
SEATS_7MAX = ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"]

# Mapping: our UTG is approximated by GTOW UTG+2.
SEAT_TO_GTOW_OPEN_POS = {
    "UTG": "UTG+2",
    "LJ": "LJ",
    "HJ": "HJ",
    "CO": "CO",
    "BTN": "BTN",
    "SB": "SB",
}


@dataclass(frozen=True)
class Spot:
    output_file: str
    description: str
    params: Dict[str, str]

@dataclass
class Checkpoint:
    """
    Persisted across runs so we can resume without repeating requests if auth expires.
    """
    open_code_by_seat: Dict[str, str]
    pair_codes: Dict[str, Dict[str, str]]  # key "OPENER|HERO" -> codes


def _load_checkpoint(path: str) -> Optional[Checkpoint]:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, dict):
        return None
    open_codes = raw.get("open_code_by_seat", {})
    pair_codes = raw.get("pair_codes", {})
    if not isinstance(open_codes, dict) or not isinstance(pair_codes, dict):
        return None
    # stringify for safety
    oc: Dict[str, str] = {str(k): str(v) for k, v in open_codes.items()}
    pc: Dict[str, Dict[str, str]] = {}
    for k, v in pair_codes.items():
        if isinstance(v, dict):
            pc[str(k)] = {str(kk): str(vv) for kk, vv in v.items()}
    return Checkpoint(open_code_by_seat=oc, pair_codes=pc)


def _save_checkpoint(path: str, ckpt: Checkpoint) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "open_code_by_seat": ckpt.open_code_by_seat,
                "pair_codes": ckpt.pair_codes,
            },
            f,
            indent=4,
            ensure_ascii=False,
        )
        f.write("\n")


def _load_existing_spots(path: str) -> List[Spot]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, dict):
        return []
    arr = raw.get("spots")
    if not isinstance(arr, list):
        return []
    out: List[Spot] = []
    for item in arr:
        if not isinstance(item, dict):
            continue
        of = item.get("output_file")
        desc = item.get("description", "")
        params = item.get("params", {})
        if isinstance(of, str) and isinstance(desc, str) and isinstance(params, dict):
            out.append(Spot(output_file=of, description=desc, params={str(k): str(v) for k, v in params.items()}))
    return out


def _write_spots(path: str, spots: List[Spot]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    out_obj = {"spots": [{"output_file": s.output_file, "description": s.description, "params": s.params} for s in spots]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, indent=4, ensure_ascii=False)
        f.write("\n")


def _non_fold_actions(preflop_actions: str) -> List[str]:
    parts = [p.strip() for p in str(preflop_actions).split("-") if p.strip()]
    return [p for p in parts if p != "F"]


def _parse_pair_key_from_filename(output_file: str) -> Optional[Tuple[str, str]]:
    """
    Returns (opener, hero) for any of the interaction filenames:
      HERO_vs_OPENER_OPEN.json
      OPENER_vs_HERO_3BET.json
      HERO_vs_OPENER_4BET.json
      OPENER_vs_HERO_5BET.json
      HERO_vs_OPENER_6BET.json
    """
    if not output_file.endswith(".json"):
        return None
    base = output_file[:-5]
    if "_vs_" not in base:
        return None
    left, right = base.split("_vs_", 1)
    if right.endswith("_OPEN"):
        hero = left
        opener = right[: -len("_OPEN")]
        return opener, hero
    if right.endswith("_3BET"):
        opener = left
        hero = right[: -len("_3BET")]
        return opener, hero
    if right.endswith("_4BET"):
        hero = left
        opener = right[: -len("_4BET")]
        return opener, hero
    if right.endswith("_5BET"):
        opener = left
        hero = right[: -len("_5BET")]
        return opener, hero
    if right.endswith("_6BET"):
        hero = left
        opener = right[: -len("_6BET")]
        return opener, hero
    return None


def _bootstrap_checkpoint_from_spots(ckpt: Checkpoint, spots: List[Spot]) -> None:
    """
    Populate missing checkpoint codes by parsing already-written spots.
    This makes --resume robust even if the previous run ended before writing the checkpoint.
    """
    for s in spots:
        pre = s.params.get("preflop_actions", "")
        acts = _non_fold_actions(pre)

        # Infer open codes by opener from any "*_vs_*_OPEN.json" spot (open is the only non-fold action)
        if s.output_file.endswith("_OPEN.json"):
            # filename is HERO_vs_OPENER_OPEN.json -> parse opener
            pair = _parse_pair_key_from_filename(s.output_file)
            if pair:
                opener, _hero = pair
                if acts:
                    # first non-fold is the open code
                    ckpt.open_code_by_seat.setdefault(opener, acts[0])

        pair = _parse_pair_key_from_filename(s.output_file)
        if not pair:
            continue
        opener, hero = pair
        key = f"{opener}|{hero}"
        codes = ckpt.pair_codes.get(key, {})

        # From the deepest nodes we can infer more codes:
        # non-fold sequence is: [open, 3b, 4b, 5b, jam]
        if s.output_file.endswith("_3BET.json") and len(acts) >= 2:
            codes.setdefault("threebet_code", acts[1])
            ckpt.open_code_by_seat.setdefault(opener, acts[0])
        elif s.output_file.endswith("_4BET.json") and len(acts) >= 3:
            codes.setdefault("threebet_code", acts[1])
            codes.setdefault("fourbet_code", acts[2])
            ckpt.open_code_by_seat.setdefault(opener, acts[0])
        elif s.output_file.endswith("_5BET.json") and len(acts) >= 4:
            codes.setdefault("threebet_code", acts[1])
            codes.setdefault("fourbet_code", acts[2])
            codes.setdefault("fivebet_code", acts[3])
            # If 5bet is already all-in, we won't have a separate 6bet jam node.
            if acts[3] == "RAI":
                codes.setdefault("fivebet_is_allin", "1")
            else:
                codes.setdefault("fivebet_is_allin", "0")
            ckpt.open_code_by_seat.setdefault(opener, acts[0])
        elif s.output_file.endswith("_6BET.json") and len(acts) >= 5:
            codes.setdefault("threebet_code", acts[1])
            codes.setdefault("fourbet_code", acts[2])
            codes.setdefault("fivebet_code", acts[3])
            codes.setdefault("jam_code", acts[4])
            codes.setdefault("fivebet_is_allin", "0")
            ckpt.open_code_by_seat.setdefault(opener, acts[0])

        if codes:
            ckpt.pair_codes[key] = codes


def _sleep_between(min_delay_s: float, max_delay_s: float) -> None:
    if min_delay_s < 0 or max_delay_s < 0:
        raise ValueError("Delays must be >= 0")
    if max_delay_s < min_delay_s:
        raise ValueError("--max-delay must be >= --min-delay")
    delay = random.uniform(min_delay_s, max_delay_s) if max_delay_s > 0 else 0.0
    if delay > 0:
        time.sleep(delay)


def _build_url(base_url: str, params: Dict[str, str]) -> str:
    query = urllib.parse.urlencode(params, doseq=False, safe="")
    return f"{base_url}?{query}"


def _default_headers(bearer_token: str, client_id: Optional[str]) -> Dict[str, str]:
    headers = {
        "accept": "application/json, text/plain, */*",
        "authorization": f"Bearer {bearer_token}",
        "origin": "https://app.gtowizard.com",
        "referer": "https://app.gtowizard.com/",
        "user-agent": "poker-odds/gtowizard-preflop-gen (non-interactive)",
    }
    if client_id:
        headers["gwclientid"] = client_id
    return headers


def _http_get_json(url: str, headers: Dict[str, str], timeout_s: float, max_retries: int) -> Any:
    last_err: Optional[BaseException] = None
    for attempt in range(max_retries + 1):
        req = urllib.request.Request(url, method="GET", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = e
            status = getattr(e, "code", None)
            if status in (429, 500, 502, 503, 504) and attempt < max_retries:
                retry_after = e.headers.get("Retry-After")
                if retry_after is not None:
                    try:
                        time.sleep(float(retry_after))
                    except ValueError:
                        time.sleep(5.0)
                else:
                    time.sleep(min(60.0, (2**attempt) + random.uniform(0.0, 1.0)))
                continue
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                body = "<unable to read error body>"
            raise FetchError(f"HTTP {status} for {url}\n{body}") from e
        except Exception as e:
            last_err = e
            if attempt < max_retries:
                time.sleep(min(60.0, (2**attempt) + random.uniform(0.0, 1.0)))
                continue
            raise FetchError(f"Request failed for {url}: {e}") from e
    raise FetchError(f"Request failed for {url}: {last_err}")


def _pick_open_code(node: Dict[str, Any]) -> str:
    # smallest non-allin raise
    raises: List[Tuple[float, str]] = []
    for sol in node.get("action_solutions", []) or []:
        action = sol.get("action", {})
        if not isinstance(action, dict):
            continue
        if str(action.get("type", "")).upper() != "RAISE":
            continue
        if action.get("allin"):
            continue
        code = action.get("code")
        betsize = action.get("betsize")
        if not isinstance(code, str) or not code:
            continue
        try:
            size_f = float(betsize)
        except Exception:
            continue
        raises.append((size_f, code))
    if not raises:
        raise ValueError("No non-allin raise action found for opener node (cannot determine open code).")
    raises.sort(key=lambda x: x[0])
    return raises[0][1]


def _pick_raise_code(node: Dict[str, Any]) -> str:
    # smallest non-allin raise (3B/4B/5B sizing)
    return _pick_open_code(node)

def _pick_raise_or_allin_code(node: Dict[str, Any]) -> Tuple[str, bool]:
    """
    Some nodes (late preflop) can be jam-only: no non-allin raise sizes exist.
    Returns (code, is_allin).
    """
    try:
        return _pick_raise_code(node), False
    except ValueError:
        return _pick_allin_code(node), True


def _pick_allin_code(node: Dict[str, Any]) -> str:
    for sol in node.get("action_solutions", []) or []:
        action = sol.get("action", {})
        if not isinstance(action, dict):
            continue
        atype = str(action.get("type", "")).upper()
        if atype not in ("RAISE", "ALLIN"):
            continue
        if action.get("allin") or atype == "ALLIN":
            code = action.get("code")
            if isinstance(code, str) and code:
                return code
    raise ValueError("No all-in raise action found (cannot determine jam code).")


def _idx(pos: str) -> int:
    try:
        return GTOW_POS_ORDER.index(pos)
    except ValueError as e:
        raise ValueError(f"Unknown GTOW position: {pos}") from e


def _folds_before_pos(pos: str) -> List[str]:
    return ["F"] * _idx(pos)


def _params_base(gametype: str, depth: int, preflop_actions: str) -> Dict[str, str]:
    return {
        "gametype": gametype,
        "depth": str(depth),
        "stacks": "",
        "preflop_actions": preflop_actions,
        "flop_actions": "",
        "turn_actions": "",
        "river_actions": "",
        "board": "",
    }


def _make_filename_rfi(seat: str) -> str:
    return f"{seat}_RFI.json"


def _make_filename_vs_open(hero: str, opener: str) -> str:
    return f"{hero}_vs_{opener}_OPEN.json"


def _make_filename_vs_3bet(opener: str, threebettor: str) -> str:
    return f"{opener}_vs_{threebettor}_3BET.json"


def _make_filename_vs_4bet(threebettor: str, opener: str) -> str:
    return f"{threebettor}_vs_{opener}_4BET.json"


def _make_filename_vs_5bet(opener: str, threebettor: str) -> str:
    return f"{opener}_vs_{threebettor}_5BET.json"


def _make_filename_vs_6bet(threebettor: str, opener: str) -> str:
    return f"{threebettor}_vs_{opener}_6BET.json"


def _pairings() -> List[Tuple[str, str]]:
    # Opener interactions exactly as you listed:
    pairs: List[Tuple[str, str]] = []
    # UTG vs {LJ,HJ,CO,BTN,SB,BB}
    for hero in ["LJ", "HJ", "CO", "BTN", "SB", "BB"]:
        pairs.append(("UTG", hero))
    # LJ vs {HJ,CO,BTN,SB,BB}
    for hero in ["HJ", "CO", "BTN", "SB", "BB"]:
        pairs.append(("LJ", hero))
    # HJ vs {CO,BTN,SB,BB}
    for hero in ["CO", "BTN", "SB", "BB"]:
        pairs.append(("HJ", hero))
    # CO vs {BTN,SB,BB}
    for hero in ["BTN", "SB", "BB"]:
        pairs.append(("CO", hero))
    # BTN vs {SB,BB}
    for hero in ["SB", "BB"]:
        pairs.append(("BTN", hero))
    # SB vs {BB}
    pairs.append(("SB", "BB"))
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate 7-max preflop spots list by discovering GTOW action codes.")
    parser.add_argument("--gametype", required=True)
    parser.add_argument("--depth", type=int, required=True)
    parser.add_argument("--out-spots", required=True, help="Where to write the generated spots JSON.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--min-delay", type=float, default=3.0)
    parser.add_argument("--max-delay", type=float, default=7.0)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Log each intermediate node: preflop_actions + discovered action codes.",
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="Optional path to write verbose logs (appends). If not set, logs go to stdout.",
    )
    parser.add_argument(
        "--checkpoint-file",
        default=None,
        help="Path to a checkpoint JSON file used for resume (defaults to <out-spots>.checkpoint.json).",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from existing out-spots/checkpoint if present (recommended).",
    )

    args = parser.parse_args()

    bearer = os.environ.get("GTOWIZARD_BEARER_TOKEN")
    if not bearer:
        raise FetchError("Missing env var: GTOWIZARD_BEARER_TOKEN")
    client_id = os.environ.get("GTOWIZARD_CLIENT_ID")
    headers = _default_headers(bearer_token=bearer, client_id=client_id)

    checkpoint_path = args.checkpoint_file or f"{args.out_spots}.checkpoint.json"

    # Resume state
    spots: List[Spot] = _load_existing_spots(args.out_spots) if args.resume else []
    existing_files = {s.output_file for s in spots}
    ckpt = _load_checkpoint(checkpoint_path) if args.resume else None
    if ckpt is None:
        ckpt = Checkpoint(open_code_by_seat={}, pair_codes={})
    if args.resume and spots:
        # Make resume robust even if checkpoint didn't get written before aborting.
        _bootstrap_checkpoint_from_spots(ckpt, spots)

    def _log(msg: str) -> None:
        if not args.verbose:
            return
        line = msg.rstrip("\n") + "\n"
        if args.log_file:
            os.makedirs(os.path.dirname(args.log_file) or ".", exist_ok=True)
            with open(args.log_file, "a", encoding="utf-8") as f:
                f.write(line)
        else:
            print(msg)

    def _need_any(*outs: str) -> bool:
        return any(o not in existing_files for o in outs)

    # 1) RFI spots for 7-max seats (UTG..SB). (BB has no RFI)
    open_code_by_seat: Dict[str, str] = dict(ckpt.open_code_by_seat)
    for seat in ["UTG", "LJ", "HJ", "CO", "BTN", "SB"]:
        if seat in open_code_by_seat and _make_filename_rfi(seat) in existing_files:
            _log(f"[RFI] seat={seat} already present; open_code={open_code_by_seat[seat]}")
            continue

        gtow_pos = SEAT_TO_GTOW_OPEN_POS[seat]
        pre = "-".join(_folds_before_pos(gtow_pos))
        params = _params_base(args.gametype, args.depth, pre)
        url = _build_url(args.base_url, params)
        node = _http_get_json(url=url, headers=headers, timeout_s=float(args.timeout), max_retries=int(args.max_retries))

        open_code = _pick_open_code(node)
        open_code_by_seat[seat] = open_code
        ckpt.open_code_by_seat[seat] = open_code
        _log(f"[RFI] seat={seat} gtow_pos={gtow_pos} preflop_actions={pre or '<empty>'} open_code={open_code}")

        out_file = _make_filename_rfi(seat)
        if out_file not in existing_files:
            spots.append(
                Spot(
                    output_file=out_file,
                    description=f"{seat} RFI (GTOW {gtow_pos}; preflop_actions={pre or '<empty>'}).",
                    params=params,
                )
            )
            existing_files.add(out_file)
            _write_spots(args.out_spots, spots)
            _save_checkpoint(checkpoint_path, ckpt)

        _sleep_between(float(args.min_delay), float(args.max_delay))

    # 2) Interaction chains up to 6-bet all-in + call node.
    for opener, hero in _pairings():
        if opener == "UTG":
            gtow_opener = "UTG+2"
        else:
            gtow_opener = opener

        # Preflop actions to reach hero decision facing open
        prefix = _folds_before_pos(gtow_opener)
        open_code = open_code_by_seat.get(opener)
        if not open_code:
            raise ValueError(f"Missing open code for opener: {opener}")
        actions: List[str] = prefix + [open_code]
        pair_key = f"{opener}|{hero}"
        codes = ckpt.pair_codes.get(pair_key, {})
        out_a = _make_filename_vs_open(hero=hero, opener=opener)
        out_b = _make_filename_vs_3bet(opener=opener, threebettor=hero)
        out_c = _make_filename_vs_4bet(threebettor=hero, opener=opener)
        out_d = _make_filename_vs_5bet(opener=opener, threebettor=hero)
        out_e = _make_filename_vs_6bet(threebettor=hero, opener=opener)
        # If we already have all 5 nodes for this pairing, skip it entirely.
        if not _need_any(out_a, out_b, out_c, out_d, out_e):
            continue

        if args.verbose:
            _log(f"[OPEN] opener={opener} hero={hero} preflop_actions={'-'.join(actions)}")

        # (A) HERO vs OPENER OPEN (3-bet node)
        pre_a = "-".join(actions)
        params_a = _params_base(args.gametype, args.depth, pre_a)
        need_3b_code = ("threebet_code" not in codes) and _need_any(out_b, out_c, out_d, out_e)
        threebet_code = codes.get("threebet_code")
        fetched_a = False
        if need_3b_code:
            if not threebet_code:
                node_a = _http_get_json(
                    url=_build_url(args.base_url, params_a),
                    headers=headers,
                    timeout_s=float(args.timeout),
                    max_retries=int(args.max_retries),
                )
                fetched_a = True
                threebet_code = _pick_raise_code(node_a)
                codes["threebet_code"] = threebet_code
                ckpt.pair_codes[pair_key] = codes
                _save_checkpoint(checkpoint_path, ckpt)
            _log(
                f"[3B][{'fetch' if fetched_a else 'cache'}] opener={opener} hero={hero} preflop_actions={pre_a} threebet_code={threebet_code}"
            )
        if out_a not in existing_files:
            spots.append(
                Spot(
                    output_file=out_a,
                    description=f"{hero} vs {opener} open (3bet decision).",
                    params=params_a,
                )
            )
            existing_files.add(out_a)
            _write_spots(args.out_spots, spots)
            _save_checkpoint(checkpoint_path, ckpt)
        if fetched_a:
            _sleep_between(float(args.min_delay), float(args.max_delay))

        # (B) OPENER vs HERO 3-bet (4-bet node)
        if _need_any(out_b, out_c, out_d, out_e) and not threebet_code:
            raise ValueError(f"Missing threebet_code for pair {pair_key} (needed to generate deeper nodes).")
        actions_b = actions + ([threebet_code] if threebet_code else [])
        pre_b = "-".join(actions_b)
        params_b = _params_base(args.gametype, args.depth, pre_b)
        need_4b_code = ("fourbet_code" not in codes) and _need_any(out_c, out_d, out_e)
        fourbet_code = codes.get("fourbet_code")
        fetched_b = False
        if need_4b_code:
            if not fourbet_code:
                node_b = _http_get_json(
                    url=_build_url(args.base_url, params_b),
                    headers=headers,
                    timeout_s=float(args.timeout),
                    max_retries=int(args.max_retries),
                )
                fetched_b = True
                fourbet_code = _pick_raise_code(node_b)
                codes["fourbet_code"] = fourbet_code
                ckpt.pair_codes[pair_key] = codes
                _save_checkpoint(checkpoint_path, ckpt)
            _log(
                f"[4B][{'fetch' if fetched_b else 'cache'}] opener={opener} hero={hero} preflop_actions={pre_b} fourbet_code={fourbet_code}"
            )
        if out_b not in existing_files:
            spots.append(
                Spot(
                    output_file=out_b,
                    description=f"{opener} vs {hero} 3bet (4bet decision).",
                    params=params_b,
                )
            )
            existing_files.add(out_b)
            _write_spots(args.out_spots, spots)
            _save_checkpoint(checkpoint_path, ckpt)
        if fetched_b:
            _sleep_between(float(args.min_delay), float(args.max_delay))

        # (C) HERO vs OPENER 4-bet (5-bet node)
        if _need_any(out_c, out_d, out_e) and not fourbet_code:
            raise ValueError(f"Missing fourbet_code for pair {pair_key} (needed to generate deeper nodes).")
        actions_c = actions_b + ([fourbet_code] if fourbet_code else [])
        pre_c = "-".join(actions_c)
        params_c = _params_base(args.gametype, args.depth, pre_c)
        need_5b_code = ("fivebet_code" not in codes) and _need_any(out_d, out_e)
        fivebet_code = codes.get("fivebet_code")
        fivebet_is_allin = codes.get("fivebet_is_allin") == "1"
        fetched_c = False
        if need_5b_code:
            if not fivebet_code:
                node_c = _http_get_json(
                    url=_build_url(args.base_url, params_c),
                    headers=headers,
                    timeout_s=float(args.timeout),
                    max_retries=int(args.max_retries),
                )
                fetched_c = True
                fivebet_code, fivebet_is_allin = _pick_raise_or_allin_code(node_c)
                codes["fivebet_code"] = fivebet_code
                codes["fivebet_is_allin"] = "1" if fivebet_is_allin else "0"
                ckpt.pair_codes[pair_key] = codes
                _save_checkpoint(checkpoint_path, ckpt)
            _log(
                f"[5B][{'fetch' if fetched_c else 'cache'}] opener={opener} hero={hero} preflop_actions={pre_c} fivebet_code={fivebet_code}"
            )
        if out_c not in existing_files:
            spots.append(
                Spot(
                    output_file=out_c,
                    description=f"{hero} vs {opener} 4bet (5bet decision).",
                    params=params_c,
                )
            )
            existing_files.add(out_c)
            _write_spots(args.out_spots, spots)
            _save_checkpoint(checkpoint_path, ckpt)
        if fetched_c:
            _sleep_between(float(args.min_delay), float(args.max_delay))

        # (D) OPENER vs HERO 5-bet (6-bet jam node)
        if _need_any(out_d, out_e) and not fivebet_code:
            raise ValueError(f"Missing fivebet_code for pair {pair_key} (needed to generate deeper nodes).")
        actions_d = actions_c + ([fivebet_code] if fivebet_code else [])
        pre_d = "-".join(actions_d)
        params_d = _params_base(args.gametype, args.depth, pre_d)
        # If 5bet is already all-in, there is no further 6bet jam node.
        need_jam_code = (not fivebet_is_allin) and ("jam_code" not in codes) and _need_any(out_e)
        jam_code = codes.get("jam_code")
        fetched_d = False
        if need_jam_code:
            if not jam_code:
                node_d = _http_get_json(
                    url=_build_url(args.base_url, params_d),
                    headers=headers,
                    timeout_s=float(args.timeout),
                    max_retries=int(args.max_retries),
                )
                fetched_d = True
                try:
                    jam_code = _pick_allin_code(node_d)
                    codes["jam_code"] = jam_code
                    ckpt.pair_codes[pair_key] = codes
                    _save_checkpoint(checkpoint_path, ckpt)
                except ValueError:
                    # No jam option exists here; stop at 5-bet nodes for this pairing.
                    jam_code = None
            _log(
                f"[6BJAM][{'fetch' if fetched_d else 'cache'}] opener={opener} hero={hero} preflop_actions={pre_d} jam_code={jam_code}"
            )
        if out_d not in existing_files:
            spots.append(
                Spot(
                    output_file=out_d,
                    description=f"{opener} vs {hero} 5bet (6bet jam decision).",
                    params=params_d,
                )
            )
            existing_files.add(out_d)
            _write_spots(args.out_spots, spots)
            _save_checkpoint(checkpoint_path, ckpt)
        if fetched_d:
            _sleep_between(float(args.min_delay), float(args.max_delay))

        # (E) HERO vs OPENER 6-bet jam (call node)
        # Only exists if there is a jam action available at node D (i.e. 5bet was not jam).
        if jam_code:
            actions_e = actions_d + [jam_code]
            pre_e = "-".join(actions_e)
            params_e = _params_base(args.gametype, args.depth, pre_e)
            if args.verbose and out_e not in existing_files:
                _log(f"[CALL] opener={opener} hero={hero} preflop_actions={pre_e}")
            if out_e not in existing_files:
                spots.append(
                    Spot(
                        output_file=out_e,
                        description=f"{hero} vs {opener} 6bet jam (call/fold decision).",
                        params=params_e,
                    )
                )
                existing_files.add(out_e)
                _write_spots(args.out_spots, spots)
                _save_checkpoint(checkpoint_path, ckpt)
        else:
            if args.verbose:
                _log(f"[END] opener={opener} hero={hero} (no further 6bet jam node available)")

    _write_spots(args.out_spots, spots)
    _save_checkpoint(checkpoint_path, ckpt)
    print(f"Generated {len(spots)} spots -> {args.out_spots}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


