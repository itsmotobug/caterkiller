const { state } = require('../state');
const { average, percentChange } = require('../math');

const HISTORY_LIMIT = 20;
const STATS_WINDOW = 12;

const recordPriceSample = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return;
  }

  state.priceHistory.push(Number(value));
  if (state.priceHistory.length > HISTORY_LIMIT) {
    state.priceHistory.shift();
  }
};

const getRecentPriceStats = () => {
  const prices = state.priceHistory.slice(-STATS_WINDOW);
  if (prices.length < 2) {
    const current = state.currentPrice || 0;
    return { avg: current, last: current, high: current, low: current, changePct: 0 };
  }

  const first = prices[0];
  const last = prices[prices.length - 1];

  return {
    avg: average(prices),
    last,
    high: Math.max(...prices),
    low: Math.min(...prices),
    changePct: percentChange(first, last),
  };
};

module.exports = { recordPriceSample, getRecentPriceStats };
