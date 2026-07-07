#!/usr/bin/env python3
"""Fetch daily close price and append to price-history.json."""

import json
import math
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
HISTORY_PATH = ROOT / "data" / "price-history.json"

TAIPEI = timezone(timedelta(hours=8))


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")


def _is_valid_entry(entry: dict) -> bool:
    try:
        price = float(entry.get("close_price"))
        return not math.isnan(price) and price > 0
    except (TypeError, ValueError):
        return False


def fetch_close_price(ticker: str) -> tuple[str, float]:
    """Return (date_str, close_price) for the latest trading day."""
    stock = yf.Ticker(ticker)
    hist = stock.history(period="5d")

    if hist.empty:
        raise RuntimeError(f"No price data returned for {ticker}")

    last_row = hist.iloc[-1]
    close_price = float(last_row["Close"])
    if math.isnan(close_price) or close_price <= 0:
        raise RuntimeError(f"Invalid close price for {ticker}: {close_price}")
    date_str = last_row.name.strftime("%Y-%m-%d")
    return date_str, close_price


def compute_metrics(config: dict, close_price: float) -> dict:
    shares = config["shares"]
    cost_basis = config["cost_basis"]
    market_value = round(close_price * shares, 2)
    loss_amount = round(cost_basis - market_value, 2)
    loss_pct = round((loss_amount / cost_basis) * 100, 2) if cost_basis else 0.0
    remaining_pct = round(100 - loss_pct, 2)

    return {
        "market_value": market_value,
        "loss_amount": loss_amount,
        "loss_pct": loss_pct,
        "remaining_pct": remaining_pct,
    }


def main() -> int:
    config = load_json(CONFIG_PATH)
    ticker = config["ticker"]

    try:
        date_str, close_price = fetch_close_price(ticker)
    except Exception as exc:
        print(f"Error fetching price for {ticker}: {exc}", file=sys.stderr)
        return 1

    history = load_json(HISTORY_PATH)
    entries = history.setdefault("entries", [])
    entries = [e for e in entries if _is_valid_entry(e)]
    history["entries"] = entries

    if entries and entries[-1].get("date") == date_str:
        print(f"Entry for {date_str} already exists, updating in place.")
        entries.pop()

    metrics = compute_metrics(config, close_price)
    entry = {
        "date": date_str,
        "close_price": round(close_price, 2),
        **metrics,
    }
    entries.append(entry)

    history["last_updated"] = datetime.now(TAIPEI).isoformat()
    history["config_snapshot"] = {
        "ticker": config["ticker"],
        "stock_name": config["stock_name"],
        "buy_price": config["buy_price"],
        "shares": config["shares"],
        "cost_basis": config["cost_basis"],
    }

    save_json(HISTORY_PATH, history)

    print(f"Updated {date_str}: close={close_price:.2f}, loss={metrics['loss_amount']:.0f} ({metrics['loss_pct']:.2f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
