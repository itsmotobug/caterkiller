const applyBuy = (position, solAmount, tokenQty) => {
  const tokens = position.tokens + (Number(tokenQty) || 0);
  const totalCostSol = position.totalCostSol + (Number(solAmount) || 0);

  return {
    ...position,
    tokens,
    totalCostSol,
    averageCostSol: tokens > 0 ? totalCostSol / tokens : 0,
    closedTrades: position.closedTrades + 1,
  };
};

const applySell = (position, tokenQty, pricePerToken) => {
  const sold = Math.min(Number(tokenQty) || 0, position.tokens);
  const value = Number(pricePerToken) * sold;
  const costBasis = position.averageCostSol * sold;
  const tokens = Math.max(0, position.tokens - sold);

  return {
    ...position,
    realizedPnL: position.realizedPnL + (value - costBasis),
    tokens,
    totalCostSol: tokens > 0 ? position.averageCostSol * tokens : 0,
    closedTrades: position.closedTrades + 1,
  };
};

const unrealizedPnl = (position, currentPrice) => {
  if (!position.tokens || !Number.isFinite(Number(currentPrice))) {
    return 0;
  }

  return Number(currentPrice) * position.tokens - position.totalCostSol;
};

const totalPnlSol = (position, currentPrice) =>
  Number((position.realizedPnL || 0) + (unrealizedPnl(position, currentPrice) || 0));

const positionPerformance = (position, currentPrice) => {
  const costBasis = Number(position.totalCostSol || 0);
  if (!Number.isFinite(costBasis) || costBasis <= 0) {
    return { pct: null, multiple: null };
  }

  const value = Number(currentPrice || 0) * Number(position.tokens || 0);
  const pct = ((value - costBasis) / costBasis) * 100;
  const multiple = value / costBasis;

  return {
    pct: Number.isFinite(pct) ? pct : null,
    multiple: Number.isFinite(multiple) ? multiple : null,
  };
};

module.exports = { applyBuy, applySell, unrealizedPnl, totalPnlSol, positionPerformance };
