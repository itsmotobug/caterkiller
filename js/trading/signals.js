const { state } = require('../state');
const { percentChange } = require('../math');
const { getRecentPriceStats, recordPriceSample } = require('./history');

const SCORERS = {
  momentum: (last, prev, stats) => percentChange(prev, last) * 2 + percentChange(stats.avg, last),
  meanReversion: (last, prev, stats) => -percentChange(stats.avg, last),
  breakout: (last, prev, stats) => percentChange(stats.high, last) * 10,
};

// Each rule is [predicate, signal], checked in order.
const RULES = {
  momentum: [
    [(score) => score >= 0.5, 'buy'],
    [(score) => score <= -0.5, 'sell'],
  ],
  meanReversion: [
    [(score) => score >= 0.8, 'sell'],
    [(score) => score <= -0.8, 'buy'],
  ],
  breakout: [
    [(score) => score >= 1, 'buy'],
    [(score) => score <= -1, 'sell'],
  ],
};

const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

const getSignalScore = () => {
  if (!state.currentPrice) {
    return 0;
  }

  const stats = getRecentPriceStats();
  const last = Number(state.currentPrice || 0);
  const prev = Number(state.lastPrice || stats.last || last);
  const scorer = lookup(SCORERS, state.strategy);

  return scorer ? scorer(last, prev, stats) : 0;
};

const signalFor = (strategy, score) => {
  const rules = lookup(RULES, strategy);
  const match = rules && rules.find(([test]) => test(score));
  return match ? match[1] : null;
};

const evaluateDca = () => {
  const knownPrice = Number(state.currentPrice || state.lastPrice || 0);
  if (!Number.isFinite(knownPrice) || knownPrice <= 0) {
    return null;
  }

  const now = Date.now();
  if (!state.dcaLastBuyAt || now - state.dcaLastBuyAt >= state.dcaIntervalMs) {
    state.dcaLastBuyAt = now;
    return 'buy';
  }

  return null;
};

const evaluateScored = () => {
  if (!state.currentPrice) {
    return null;
  }

  recordPriceSample(state.currentPrice);

  const score = getSignalScore();
  const now = Date.now();
  if (state.lastSignalAt && now - state.lastSignalAt < state.strategyCooldownMs) {
    return null;
  }

  const signal = signalFor(state.strategy, score);
  if (signal) {
    state.lastSignalAt = now;
  }
  return signal;
};

const evaluateSignal = () => (state.strategy === 'dca' ? evaluateDca() : evaluateScored());

module.exports = { evaluateSignal, getSignalScore };
