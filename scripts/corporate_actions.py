#!/usr/bin/env python3
"""Corporate-action (ex-dividend / ex-rights) helpers — DER-44 plan A.

Raw closes stay untouched. Adjustment is event-driven from
``data/corporate_actions.json``:

- Backward price restore for dates *before* an event:
  ``adj = (P - cash) / (1 + stock_ratio)``
- Holdings are derived from config + cumulative actions (no hardcoding).
- Dual-track P&L:
  - 價差 uses restored cost vs adjusted/raw price
  - 總報酬 uses original cost vs (market value + cash received)
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACTIONS_PATH = ROOT / "data" / "corporate_actions.json"
CONFIG_PATH = ROOT / "config.json"


@dataclass(frozen=True)
class Action:
    date: str
    cash_dividend: float
    stock_dividend_ratio: float
    label: str = ""


@dataclass(frozen=True)
class Position:
    """Derived holdings as of a calendar date (inclusive of that day's actions)."""

    shares: float
    cash_received: float
    restored_cost_basis: float
    restored_buy_price: float
    original_shares: float
    original_cost_basis: float
    original_buy_price: float


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_actions(path: Path = ACTIONS_PATH) -> list[Action]:
    if not path.exists():
        return []
    raw = load_json(path)
    actions: list[Action] = []
    for item in raw.get("actions", []):
        actions.append(
            Action(
                date=str(item["date"]),
                cash_dividend=float(item.get("cash_dividend", 0) or 0),
                stock_dividend_ratio=float(item.get("stock_dividend_ratio", 0) or 0),
                label=str(item.get("label") or ""),
            )
        )
    return sorted(actions, key=lambda a: a.date)


def adjust_price(raw_price: float, as_of: str, actions: list[Action]) -> float:
    """Backward-restore ``raw_price`` observed on ``as_of`` to the latest scale.

    For each action with ``action.date > as_of``, apply
    ``(P - cash) / (1 + ratio)`` (newest events applied first so chained
    events compose correctly).
    """
    price = float(raw_price)
    for action in sorted(actions, key=lambda a: a.date, reverse=True):
        if as_of >= action.date:
            continue
        divisor = 1.0 + action.stock_dividend_ratio
        if divisor <= 0:
            raise ValueError(f"Invalid stock_dividend_ratio on {action.date}")
        price = (price - action.cash_dividend) / divisor
    return price


def derive_position(config: dict, as_of: str, actions: list[Action]) -> Position:
    """Derive shares / cash / restored cost from base config + actions ≤ as_of."""
    shares = float(config["shares"])
    original_shares = shares
    original_cost = float(config["cost_basis"])
    original_buy = float(config["buy_price"])
    cash_received = 0.0

    for action in actions:
        if action.date > as_of:
            break
        if action.cash_dividend:
            cash_received += shares * action.cash_dividend
        if action.stock_dividend_ratio:
            shares *= 1.0 + action.stock_dividend_ratio

    restored_cost = original_cost - cash_received
    restored_buy = restored_cost / shares if shares else 0.0
    return Position(
        shares=shares,
        cash_received=cash_received,
        restored_cost_basis=restored_cost,
        restored_buy_price=restored_buy,
        original_shares=original_shares,
        original_cost_basis=original_cost,
        original_buy_price=original_buy,
    )


def _scale_date_for_adjusted_price(as_of: str, actions: list[Action]) -> str:
    """Date whose derived position matches ``adjust_price`` output scale.

    Backward restoration folds in future events, so 價差 must use the
    restored cost / share count *after* those same events — never mix
    pre-event cost with post-event adjusted prices.
    """
    scale = as_of
    for action in actions:
        if action.date > as_of:
            scale = action.date if action.date > scale else scale
    return scale


def compute_dual_metrics(
    config: dict,
    raw_close: float,
    as_of: str,
    actions: list[Action] | None = None,
) -> dict:
    """Return dual-track metrics; ``close_price`` remains the raw quote."""
    if actions is None:
        actions = load_actions()

    pos_total = derive_position(config, as_of, actions)
    adj_close = adjust_price(raw_close, as_of, actions)
    pos_price = derive_position(config, _scale_date_for_adjusted_price(as_of, actions), actions)

    # 價差：還原成本 vs 還原價（與向後還原同一尺度，禁與原始成本混算）
    price_market_value = round(adj_close * pos_price.shares, 2)
    price_loss_amount = round(pos_price.restored_cost_basis - price_market_value, 2)
    price_loss_pct = (
        round((price_loss_amount / pos_price.restored_cost_basis) * 100, 2)
        if pos_price.restored_cost_basis
        else 0.0
    )

    # 總報酬：原始成本 vs（市值＋截至 as_of 已收現金）；禁與還原成本混算
    market_value = round(raw_close * pos_total.shares, 2)
    total_value = round(market_value + pos_total.cash_received, 2)
    loss_amount = round(pos_total.original_cost_basis - total_value, 2)
    loss_pct = (
        round((loss_amount / pos_total.original_cost_basis) * 100, 2)
        if pos_total.original_cost_basis
        else 0.0
    )
    remaining_pct = round(100 - loss_pct, 2)

    shares_out = pos_total.shares
    if float(shares_out).is_integer():
        shares_out = int(shares_out)
    else:
        shares_out = round(shares_out, 4)

    return {
        "close_price": round(raw_close, 2),
        "adj_close": round(adj_close, 4),
        "market_value": market_value,
        "total_value": total_value,
        "cash_received": round(pos_total.cash_received, 2),
        "shares": shares_out,
        "restored_buy_price": round(pos_price.restored_buy_price, 2),
        "restored_cost_basis": round(pos_price.restored_cost_basis, 2),
        # Primary (總報酬) — dashboard / ship depth
        "loss_amount": loss_amount,
        "loss_pct": loss_pct,
        "remaining_pct": remaining_pct,
        # Secondary (價差)
        "price_loss_amount": price_loss_amount,
        "price_loss_pct": price_loss_pct,
        "price_remaining_pct": round(100 - price_loss_pct, 2),
    }


def run_assertions() -> None:
    """Three conservation checks from DER-44 (broker reconciliation)."""
    config = load_json(CONFIG_PATH)
    actions = load_actions()
    assert actions, "corporate_actions.json must define at least one action"

    action = actions[0]
    # 1) 參考價：378 → 251.0
    ref = (378.0 - action.cash_dividend) / (1.0 + action.stock_dividend_ratio)
    assert abs(ref - 251.0) < 1e-9, f"ref price expected 251.0, got {ref}"
    assert abs(adjust_price(378.0, "2026-07-17", actions) - 251.0) < 1e-9

    # 2) 持倉推導 + 總資產守恆 3,402,000
    pos = derive_position(config, action.date, actions)
    assert abs(pos.shares - 13500) < 1e-9, f"shares expected 13500, got {pos.shares}"
    assert abs(pos.restored_buy_price - 359.15) < 0.005, (
        f"restored buy expected ~359.15, got {pos.restored_buy_price}"
    )
    assert abs(pos.cash_received - 13500) < 1e-9

    assets_pre = 9000 * 378.0
    assets_post = pos.shares * 251.0 + pos.cash_received
    assert abs(assets_pre - 3_402_000) < 1e-6
    assert abs(assets_post - 3_402_000) < 1e-6, (
        f"post assets expected 3402000, got {assets_post}"
    )

    # 3) 總報酬 −30.03% 跨事件日連續
    pre = compute_dual_metrics(config, 378.0, "2026-07-17", actions)
    post = compute_dual_metrics(config, 251.0, action.date, actions)
    assert pre["loss_pct"] == 30.03, f"pre total return {pre['loss_pct']}"
    assert post["loss_pct"] == 30.03, f"post total return {post['loss_pct']}"
    assert pre["total_value"] == post["total_value"] == 3_402_000

    # 價差線在還原後亦連續（允許 0.01 捨入）
    assert abs(pre["price_loss_pct"] - post["price_loss_pct"]) <= 0.01
    assert abs(pre["adj_close"] - 251.0) < 1e-9
    assert abs(post["adj_close"] - 251.0) < 1e-9

    print("corporate_actions assertions OK:")
    print(f"  ref 378→{ref:.1f}")
    print(f"  shares={pos.shares:.0f} restored_buy={pos.restored_buy_price:.2f}")
    print(f"  assets={assets_post:.0f} total_return=-{pre['loss_pct']:.2f}% (continuous)")


def main() -> int:
    try:
        run_assertions()
    except AssertionError as exc:
        print(f"ASSERTION FAILED: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
