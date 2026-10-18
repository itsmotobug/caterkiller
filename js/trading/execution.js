const { state } = require('../state');
const { PLACEHOLDER_DEFAULTS } = require('../config');
const { round, share } = require('../math');
const { formatSolAmount, formatPrice } = require('../format');
const { applyBuy, applySell, unrealizedPnl } = require('./position');
const { tradeRequest } = require('../api/trade');

const requireMint = () => {
  if (!state.mint) {
    console.log('Set a mint first with <MINT> or `mint <address>`');
    return false;
  }
  return true;
};

const buy = async (solAmount) => {
  if (!requireMint()) return;

  const amount = Number(solAmount) || PLACEHOLDER_DEFAULTS.BUY_SOL;
  const quotePrice = state.currentPrice || PLACEHOLDER_DEFAULTS.SOL_PRICE;
  const tokens = amount / quotePrice;

  if (state.mode !== 'live') {
    console.log('Simulation buy: ' + amount + ' SOL on mint ' + state.mint);
    state.position = applyBuy(state.position, amount, tokens);
    state.currentPrice = state.currentPrice || quotePrice;
    console.log('  cost basis: ' + formatPrice(state.position.averageCostSol, 'SOL/token'));
    console.log('  PnL now: ' + formatSolAmount(unrealizedPnl(state.position, state.currentPrice), 9) + ' SOL');
    return { fake: true };
  }

  console.log('Real buy: ' + amount + ' SOL on mint ' + state.mint);
  const result = await tradeRequest('buy', state.mint, amount, true, 10);
  if (result && result.signature) {
    state.position = applyBuy(state.position, amount, tokens);
  }
  return result;
};

const sell = async (sellPercent = 100) => {
  if (!requireMint()) return;

  const percent = Number(sellPercent) || 100;
  const targetTokens = share(state.position.tokens || 0, percent);
  const price = state.currentPrice || state.position.averageCostSol || PLACEHOLDER_DEFAULTS.SOL_PRICE;

  if (state.mode !== 'live') {
    console.log('Simulation sell: ' + percent + '% of current mint position');
    state.position = applySell(state.position, targetTokens, price);
    console.log('  remaining tokens: ' + round(state.position.tokens, 6));
    console.log('  realized PnL: ' + round(state.position.realizedPnL, 6) + ' SOL');
    return { fake: true };
  }

  console.log('Real sell: ' + percent + '% of current mint position');
  // Pre-existing behavior: the on-chain request is always '100%', while the local position
  // is reduced by `percent`. Left unchanged in this refactor.
  const result = await tradeRequest('sell', state.mint, '100%', false, 10);
  if (result && result.signature) {
    state.position = applySell(state.position, targetTokens, price);
  }
  return result;
};

module.exports = { buy, sell };
