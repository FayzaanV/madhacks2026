"""Yomi core math: LMSR pricing, Clout rules, payouts, Brier/calibration.

Python mirror of app/src/core/*.ts. Both are tested against lib/test-vectors.json,
so any change here must be made in the TypeScript too (and vice versa).
Stdlib only, so it runs locally, in notebooks, and inside pipelines.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

DEFAULT_B = 500.0          # a 10-Clout bet moves a 50/50 binary market by ~1 point
STARTING_CLOUT = 100.0     # every account starts here

TIERS = (                  # (min clout, privilege)
    (1000, "moderate"),
    (500, "resolve"),
    (250, "propose"),
)


# ---------------------------------------------------------------- LMSR
def _lse(q: Sequence[float], b: float) -> tuple[float, list[float]]:
    """Return (m, exps) with exps[j] = exp(q_j/b - m), m = max(q)/b (log-sum-exp)."""
    m = max(q) / b
    return m, [math.exp(x / b - m) for x in q]


def cost(q: Sequence[float], b: float = DEFAULT_B) -> float:
    """LMSR cost function C(q) = b * ln(sum_j exp(q_j / b))."""
    m, e = _lse(q, b)
    return b * (m + math.log(sum(e)))


def prices(q: Sequence[float], b: float = DEFAULT_B) -> list[float]:
    """Implied probabilities p_i = exp(q_i/b) / sum_j exp(q_j/b)."""
    _, e = _lse(q, b)
    s = sum(e)
    return [x / s for x in e]


def cost_to_buy(q: Sequence[float], i: int, shares: float, b: float = DEFAULT_B) -> float:
    """Clout needed to buy `shares` of outcome i: C(q + shares*e_i) - C(q)."""
    q2 = list(q)
    q2[i] += shares
    return cost(q2, b) - cost(q, b)


def shares_for_amount(q: Sequence[float], i: int, amount: float, b: float = DEFAULT_B) -> float:
    """Shares of outcome i received for spending `amount` Clout (closed form).

    delta = b * ln((S*exp(a/b) - S + E_i) / E_i), computed with exps scaled by exp(-max q/b).
    """
    if amount <= 0:
        return 0.0
    _, e = _lse(q, b)
    s, ei = sum(e), e[i]
    # (S*e^(a/b) - S + E_i)/E_i = 1 + (S/E_i)*(e^(a/b) - 1); expm1 keeps small bets precise
    return b * math.log1p((s / ei) * math.expm1(amount / b))


def apply_trade(q: Sequence[float], i: int, amount: float, b: float = DEFAULT_B):
    """Return (new_q, shares, post_trade_price_of_i)."""
    shares = shares_for_amount(q, i, amount, b)
    q2 = list(q)
    q2[i] += shares
    return q2, shares, prices(q2, b)[i]


def max_market_maker_loss(n_outcomes: int, b: float = DEFAULT_B) -> float:
    return b * math.log(n_outcomes)


# ---------------------------------------------------------------- Clout rules
def can_afford(balance: float, amount: float) -> bool:
    """Betting spends Clout immediately; you can bet any amount up to your balance."""
    return 0 < amount <= balance + 1e-9


def privileges(clout: float) -> list[str]:
    """Privileges unlocked by true Clout. Everyone can trade and comment."""
    out = ["trade", "comment"]
    for threshold, name in sorted(TIERS):
        if clout >= threshold:
            out.append(name)
    return out


def payout(shares_by_outcome: dict[int, float], winning_outcome: int) -> float:
    """Each winning share pays 1 Clout; losing shares pay 0."""
    return float(shares_by_outcome.get(winning_outcome, 0.0))


def net_clout_change(trades: Iterable[tuple[int, float, float]], winning_outcome: int) -> float:
    """trades: (outcome_index, clout_spent, shares). Net = winning shares - total spent."""
    won = spent = 0.0
    for outcome, amount, shares in trades:
        spent += amount
        if outcome == winning_outcome:
            won += shares
    return won - spent


def smart_money(stakes: Iterable[tuple[float, int, float]], n_outcomes: int) -> list[float] | None:
    """Smart Money line: stakes weighted by each user's realized profit, profitable users only.

    stakes: (weight, outcome_index, clout_staked). weight = realized profit (resolved winnings - resolved
    spend); only users with weight > 0 count.
    Returns one probability per outcome (sums to 1), or None if no positive-Clout stake.
    """
    w = [0.0] * n_outcomes
    for user_clout, outcome, staked in stakes:
        if user_clout > 0 and staked > 0:
            w[outcome] += user_clout * staked
    total = sum(w)
    return [x / total for x in w] if total > 0 else None


# ---------------------------------------------------------------- scoring
def brier(forecast: float, outcome: int) -> float:
    """(f - o)^2, lower is better."""
    return (forecast - outcome) ** 2


def mean_brier(pairs: Iterable[tuple[float, int]]) -> float | None:
    pairs = list(pairs)
    if not pairs:
        return None
    return sum(brier(f, o) for f, o in pairs) / len(pairs)


def calibration_bucket(forecast: float) -> int:
    """10% bins: 0 -> [0,0.1), ..., 9 -> [0.9,1.0]."""
    return min(9, max(0, int(forecast * 10)))


def calibration_curve(pairs: Iterable[tuple[float, int]]) -> list[dict]:
    """Per non-empty bucket: mean forecast vs hit rate."""
    bins: dict[int, list[tuple[float, int]]] = {}
    for f, o in pairs:
        bins.setdefault(calibration_bucket(f), []).append((f, o))
    return [
        {
            "bucket": k,
            "n": len(v),
            "mean_forecast": sum(f for f, _ in v) / len(v),
            "hit_rate": sum(o for _, o in v) / len(v),
        }
        for k, v in sorted(bins.items())
    ]
