#!/usr/bin/env python3
"""
Fetch GTOWizard spot-solution JSON (preflop) slowly + safely and save into data/import_ranges/.

Notes:
- This script is intentionally rate-limited (sleep + jitter) and resumable.
- Do NOT hardcode your Bearer token in git-tracked files. Provide it via env var:
    export GTOWIZARD_BEARER_TOKEN='...'
- Optional: export GTOWIZARD_CLIENT_ID='...'

Example:
  python3 scripts/fetch_gtowizard_spot_solutions.py \
    --spots data/import_ranges/gtowizard_spots.example.json \
    --out-dir data/import_ranges \
    --min-delay 3.0 --max-delay 7.0
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple


DEFAULT_BASE_URL = "https://api.gtowizard.com/v4/solutions/spot-solution/"


class FetchError(RuntimeError):
    pass


def _json_dump_pretty(obj: Any) -> str:
    return json.dumps(obj, indent=4, sort_keys=False, ensure_ascii=False) + "\n"


def _sleep_between(min_delay_s: float, max_delay_s: float) -> None:
    if min_delay_s < 0 or max_delay_s < 0:
        raise ValueError("Delays must be >= 0")
    if max_delay_s < min_delay_s:
        raise ValueError("--max-delay must be >= --min-delay")
    delay = random.uniform(min_delay_s, max_delay_s) if max_delay_s > 0 else 0.0
    if delay > 0:
        time.sleep(delay)


def _load_json_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _atomic_write(path: str, contents: str) -> None:
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(contents)
    os.replace(tmp_path, path)


def _build_url(base_url: str, params: Dict[str, str]) -> str:
    # Keep blank params (e.g. board=) because GTOWizard expects them.
    query = urllib.parse.urlencode(params, doseq=False, safe="")
    return f"{base_url}?{query}"


def _http_get_json(
    url: str,
    headers: Dict[str, str],
    timeout_s: float,
    max_retries: int,
) -> Any:
    """
    Fail-fast on non-transient errors. Retry on 429/5xx (transient).
    Respects Retry-After when present.
    """
    last_err: Optional[BaseException] = None
    for attempt in range(max_retries + 1):
        req = urllib.request.Request(url, method="GET", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                raw = resp.read()
                try:
                    return json.loads(raw.decode("utf-8"))
                except Exception as e:
                    raise FetchError(f"Failed to decode JSON from response: {e}") from e
        except urllib.error.HTTPError as e:
            last_err = e
            status = getattr(e, "code", None)
            # Transient: rate-limited or server error
            if status in (429, 500, 502, 503, 504) and attempt < max_retries:
                retry_after = e.headers.get("Retry-After")
                if retry_after is not None:
                    try:
                        sleep_s = float(retry_after)
                    except ValueError:
                        sleep_s = 5.0
                else:
                    # exponential backoff with jitter
                    sleep_s = min(60.0, (2**attempt) + random.uniform(0.0, 1.0))
                time.sleep(sleep_s)
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
                # network hiccup; retry
                time.sleep(min(60.0, (2**attempt) + random.uniform(0.0, 1.0)))
                continue
            raise FetchError(f"Request failed for {url}: {e}") from e

    raise FetchError(f"Request failed for {url}: {last_err}")


def _normalize_positions_in_obj(obj: Any, position_map: Dict[str, str]) -> Any:
    """
    Recursively walks a JSON-able object and rewrites known position strings when they occur
    in common GTOWizard fields (position, active_position, next_position).

    For 7-max CoinPoker approximation, you generally want:
    - UTG+2 -> UTG
    - UTG -> UTG_9 (to avoid collisions; GTOW 9-max UTG doesn't exist in 7-max)
    """
    if isinstance(obj, list):
        return [_normalize_positions_in_obj(x, position_map) for x in obj]
    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for k, v in obj.items():
            if k in ("position", "active_position", "next_position") and isinstance(v, str):
                out[k] = position_map.get(v, v)
            else:
                out[k] = _normalize_positions_in_obj(v, position_map)
        return out
    return obj


def _validate_unique_positions(data: Any) -> None:
    if not isinstance(data, dict):
        return
    game = data.get("game")
    if not isinstance(game, dict):
        return
    players = game.get("players")
    if not isinstance(players, list):
        return
    seen: set[str] = set()
    dupes: set[str] = set()
    for p in players:
        if not isinstance(p, dict):
            continue
        pos = p.get("position")
        if not isinstance(pos, str):
            continue
        if pos in seen:
            dupes.add(pos)
        seen.add(pos)
    if dupes:
        raise ValueError(f"Duplicate positions detected after normalization: {sorted(dupes)}")


def _validate_active_position(data: Any, allowed_positions: Optional[set[str]]) -> None:
    if not allowed_positions:
        return
    if not isinstance(data, dict):
        raise ValueError("Downloaded JSON root must be an object.")
    game = data.get("game")
    if not isinstance(game, dict):
        raise ValueError("Downloaded JSON is missing 'game' object.")
    active = game.get("active_position")
    if not isinstance(active, str) or not active:
        raise ValueError("Downloaded JSON is missing 'game.active_position'.")
    if active not in allowed_positions:
        raise ValueError(f"Active position '{active}' not in allowed set: {sorted(allowed_positions)}")


def _default_headers(bearer_token: str, client_id: Optional[str]) -> Dict[str, str]:
    headers = {
        "accept": "application/json, text/plain, */*",
        "authorization": f"Bearer {bearer_token}",
        "origin": "https://app.gtowizard.com",
        "referer": "https://app.gtowizard.com/",
        # User-agent is sometimes required by APIs behind bot protection.
        "user-agent": "poker-odds/gtowizard-fetch (non-interactive)",
    }
    if client_id:
        headers["gwclientid"] = client_id
    return headers


def _validate_spot(spot: Dict[str, Any]) -> Tuple[str, Dict[str, str]]:
    if "output_file" not in spot or not isinstance(spot["output_file"], str) or not spot["output_file"]:
        raise ValueError("Each spot must have non-empty string field: output_file")
    if "params" not in spot or not isinstance(spot["params"], dict):
        raise ValueError("Each spot must have object field: params")

    # We want consistent strings for urlencode
    params: Dict[str, str] = {}
    for k, v in spot["params"].items():
        if v is None:
            params[str(k)] = ""
        else:
            params[str(k)] = str(v)

    return spot["output_file"], params


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch GTOWizard spot-solution JSON slowly and save to disk.")
    parser.add_argument("--spots", required=True, help="Path to a JSON file listing spots to fetch.")
    parser.add_argument("--out-dir", required=True, help="Output directory for saved JSON files.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="GTOWizard spot-solution base URL.")
    parser.add_argument("--min-delay", type=float, default=3.0, help="Minimum delay between requests (seconds).")
    parser.add_argument("--max-delay", type=float, default=7.0, help="Maximum delay between requests (seconds).")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout (seconds).")
    parser.add_argument("--max-retries", type=int, default=5, help="Retries on 429/5xx/network hiccups.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing output files. Default: skip if file exists.",
    )

    # CoinPoker normalization: user requested UTG+2 == UTG
    parser.add_argument(
        "--position-map",
        default="UTG=UTG_9,UTG+2=UTG",
        help="Comma-separated mapping like 'UTG+2=UTG,UTG=UTG_9'. Default is 7-max approximation: UTG+2=UTG and GTOW UTG -> UTG_9 to avoid collisions.",
    )
    parser.add_argument(
        "--allowed-active-positions",
        default="UTG,LJ,HJ,CO,BTN,SB,BB",
        help="Comma-separated allowed values for game.active_position after mapping. Default is 7-max: UTG,LJ,HJ,CO,BTN,SB,BB.",
    )

    args = parser.parse_args()

    bearer = os.environ.get("GTOWIZARD_BEARER_TOKEN")
    if not bearer:
        raise FetchError("Missing env var: GTOWIZARD_BEARER_TOKEN")
    client_id = os.environ.get("GTOWIZARD_CLIENT_ID")

    position_map: Dict[str, str] = {}
    if args.position_map:
        for part in args.position_map.split(","):
            part = part.strip()
            if not part:
                continue
            if "=" not in part:
                raise ValueError(f"Invalid --position-map entry (expected A=B): {part}")
            src, dst = part.split("=", 1)
            src = src.strip()
            dst = dst.strip()
            if not src or not dst:
                raise ValueError(f"Invalid --position-map entry (empty side): {part}")
            position_map[src] = dst

    allowed_positions: Optional[set[str]] = None
    if args.allowed_active_positions is not None:
        allowed_positions = set()
        for p in str(args.allowed_active_positions).split(","):
            p = p.strip()
            if p:
                allowed_positions.add(p)
        if not allowed_positions:
            allowed_positions = None

    cfg = _load_json_file(args.spots)
    if not isinstance(cfg, dict) or "spots" not in cfg or not isinstance(cfg["spots"], list):
        raise ValueError("Spots file must be an object with a top-level 'spots' array.")

    headers = _default_headers(bearer_token=bearer, client_id=client_id)
    _ensure_dir(args.out_dir)

    for idx, spot in enumerate(cfg["spots"]):
        if not isinstance(spot, dict):
            raise ValueError(f"Spot at index {idx} must be an object.")

        output_file, params = _validate_spot(spot)
        out_path = os.path.join(args.out_dir, output_file)

        if os.path.exists(out_path) and not args.overwrite:
            print(f"[skip] {output_file} already exists")
            continue

        url = _build_url(args.base_url, params)
        print(f"[fetch] {output_file}")

        data = _http_get_json(
            url=url,
            headers=headers,
            timeout_s=float(args.timeout),
            max_retries=int(args.max_retries),
        )

        # Normalize positions for CoinPoker naming (e.g., UTG+2 -> UTG) while avoiding collisions
        if position_map:
            data = _normalize_positions_in_obj(data, position_map)
            _validate_unique_positions(data)

        # Sanity check: only keep spots whose acting seat is one of our 7-max positions.
        _validate_active_position(data, allowed_positions)

        _atomic_write(out_path, _json_dump_pretty(data))

        # Delay after each request to be polite / avoid throttling
        _sleep_between(float(args.min_delay), float(args.max_delay))

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


