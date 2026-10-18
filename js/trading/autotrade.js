const { state } = require('../state');
const { PLACEHOLDER_DEFAULTS } = require('../config');
const { debugTradeSignal } = require('../log');
const { evaluateSignal } = require('./signals');
const { buy, sell } = require('./execution');

const priceLabel = (value) => (value != null ? value : 'n/a');

const logStrategyAction = (action, amountSol) => {
  const readableAmount = Number.isFinite(Number(amountSol)) ? Number(amountSol).toFixed(6) + ' SOL' : 'configured amount';
  const summary = '[strategy] ' + state.strategy + ' -> ' + action.toUpperCase() + ' ' + readableAmount;
  debugTradeSignal(summary + ' | price=' + priceLabel(state.currentPrice) + ' | last=' + priceLabel(state.lastPrice));
  console.log(summary);
};

const maybeAutoTrade = async () => {
  if (!state.botRunning || !state.mint) {
    return;
  }

  const knownPrice = Number(state.currentPrice || state.lastPrice || 0);
  if (!Number.isFinite(knownPrice) || knownPrice <= 0) {
    return;
  }

  const signal = evaluateSignal();
  if (!signal) {
    debugTradeSignal('signal rejected: strategy=' + state.strategy + ' | price=' + priceLabel(state.currentPrice) + ' | last=' + priceLabel(state.lastPrice));
    return;
  }

  debugTradeSignal('trade signal accepted: strategy=' + state.strategy + ' | signal=' + signal + ' | price=' + priceLabel(state.currentPrice));

  if (signal === 'buy') {
    const amount = Number.isFinite(state.buyAmountSol) && state.buyAmountSol > 0 ? state.buyAmountSol : PLACEHOLDER_DEFAULTS.BUY_SOL;
    logStrategyAction('buy', amount);
    await buy(amount);
  }

  if (signal === 'sell' && state.position.tokens > 0) {
    logStrategyAction('sell', 100);
    await sell(100);
  }
};

module.exports = { maybeAutoTrade };
