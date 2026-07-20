#!/usr/bin/env python3
"""Fetch daily close price and append to price-history.json."""

import json
import math
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))

from corporate_actions import compute_dual_metrics, load_actions  # noqa: E402

CONFIG_PATH = ROOT / "config.json"
HISTORY_PATH = ROOT / "data" / "price-history.json"

TAIPEI = timezone(timedelta(hours=8))

# Yahoo sometimes writes premature ex-rights/ex-dividend prices into the
# latest daily bar while regularMarketPrice still reflects the real close.
# Reject history bars that disagree with the quote by this relative amount.
QUOTE_DISAGREE_PCT = 0.05


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


def _quote_price(stock: yf.Ticker) -> float | None:
    """Best-effort last traded / regular-session price from Yahoo quote fields."""
    try:
        info = stock.info or {}
    except Exception:
        info = {}

    for key in ("regularMarketPrice", "currentPrice", "postMarketPrice"):
        value = info.get(key)
        try:
            price = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isnan(price) and price > 0:
            return price
    return None


def _should_prefer_quote(hist_close: float, quote: float, prev_close: float | None) -> bool:
    if quote <= 0:
        return False
    disagree = abs(hist_close - quote) / quote
    if disagree < QUOTE_DISAGREE_PCT:
        return False
    if prev_close is None or prev_close <= 0:
        return True
    # Prefer whichever price is closer to the prior session close.
    return abs(quote - prev_close) < abs(hist_close - prev_close)


def fetch_close_price(ticker: str) -> tuple[str, float]:
    """Return (date_str, close_price) for the latest trading day."""
    stock = yf.Ticker(ticker)
    hist = stock.history(period="10d", auto_adjust=False)

    if hist.empty:
        raise RuntimeError(f"No price data returned for {ticker}")

    # Skip zero-volume placeholder rows when a real session exists after them.
    usable = hist
    if "Volume" in hist.columns and len(hist) > 1:
        nonzero = hist[hist["Volume"].fillna(0) > 0]
        if not nonzero.empty:
            usable = nonzero

    last_row = usable.iloc[-1]
    hist_close = float(last_row["Close"])
    if math.isnan(hist_close) or hist_close <= 0:
        raise RuntimeError(f"Invalid close price for {ticker}: {hist_close}")
    date_str = last_row.name.strftime("%Y-%m-%d")

    prev_close = None
    if len(usable) >= 2:
        prev_close = float(usable.iloc[-2]["Close"])

    quote = _quote_price(stock)
    close_price = hist_close
    if quote is not None and _should_prefer_quote(hist_close, quote, prev_close):
        print(
            f"Warning: Yahoo history close {hist_close:.4f} disagrees with "
            f"quote {quote:.4f} on {date_str}; using quote "
            f"(likely premature ex-rights adjustment).",
            file=sys.stderr,
        )
        close_price = quote

    return date_str, close_price


def compute_metrics(config: dict, close_price: float, as_of: str | None = None) -> dict:
    """Dual-track metrics via corporate_actions; raw close is never rewritten."""
    date_str = as_of or datetime.now(TAIPEI).strftime("%Y-%m-%d")
    dual = compute_dual_metrics(config, close_price, date_str, load_actions())
    # Persist fields the dashboard / history consumers expect, plus dual-track extras.
    return {
        "market_value": dual["market_value"],
        "total_value": dual["total_value"],
        "cash_received": dual["cash_received"],
        "shares": dual["shares"],
        "adj_close": dual["adj_close"],
        "restored_buy_price": dual["restored_buy_price"],
        "restored_cost_basis": dual["restored_cost_basis"],
        "loss_amount": dual["loss_amount"],
        "loss_pct": dual["loss_pct"],
        "remaining_pct": dual["remaining_pct"],
        "price_loss_amount": dual["price_loss_amount"],
        "price_loss_pct": dual["price_loss_pct"],
        "price_remaining_pct": dual["price_remaining_pct"],
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

    metrics = compute_metrics(config, close_price, date_str)
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
