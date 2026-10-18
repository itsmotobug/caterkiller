const { state } = require('../state');
const { formatPrice, formatSolAmount, formatPercent, formatMoney } = require('../format');
const { logStatus } = require('../log');
const { getRecentPriceStats } = require('../trading/history');
const { totalPnlSol, unrealizedPnl, positionPerformance } = require('../trading/position');
const { describeStrategy } = require('../trading/strategy');
const { getCurrentTokenSymbol } = require('../trading/token');
const { ensureSolanaUsdPrice } = require('../api/solana');
const { getTokenDisplayName } = require('../api/pumpfun');

const STATUS_INTERVAL_MS = 5000;

const row = (label, value) => console.log('  ' + (label + ':').padEnd(19) + value);

const isInputPending = () => Boolean(state.rl && typeof state.rl.line === 'string' && state.rl.line.length > 0);

const lastApiCallLabel = () => (state.lastPumpPortalApiCallAt ? new Date(state.lastPumpPortalApiCallAt).toISOString() : 'never');

const intervalLabel = () => (state.strategy === 'dca' ? (state.dcaIntervalMs / 1000) + 's' : 'n/a');

const buyAmountLabel = () => (Number.isFinite(state.buyAmountSol) && state.buyAmountSol > 0 ? state.buyAmountSol + ' SOL' : 'n/a');

const getProfitUsd = () => {
  const pnlSol = totalPnlSol(state.position, state.currentPrice);
  if (!Number.isFinite(pnlSol)) {
    return null;
  }

  if (!Number.isFinite(state.solanaUsdPrice) || state.solanaUsdPrice <= 0) {
    return null;
  }

  return pnlSol * state.solanaUsdPrice;
};

const renderStatusBanner = (force = false) => {
  if (state.liveConfirmationPending || isInputPending()) {
    return;
  }

  const now = Date.now();
  if (!force && now - state.lastStatusRenderAt < state.statusRenderThrottleMs) {
    return;
  }

  const ageSeconds = state.lastWsEventAt ? Math.max(0, Math.round((Date.now() - state.lastWsEventAt) / 1000)) : 0;
  logStatus(
    'Trading ' + getCurrentTokenSymbol() + ' | ' + formatPrice(state.currentPrice, 'SOL') +
      ' | last event received (' + ageSeconds + 's ago) | ws events since startup ' + state.sessionEventCount,
  );
  state.lastStatusRenderAt = now;
};

const startStatusRenderLoop = () => {
  if (state.statusRenderLoop) {
    return;
  }

  state.statusRenderLoop = setInterval(() => {
    if (state.liveConfirmationPending || !state.liveStreamReady || !state.mint || isInputPending()) {
      return;
    }
    renderStatusBanner();
  }, STATUS_INTERVAL_MS);
};

const stopStatusRenderLoop = () => {
  if (state.statusRenderLoop) {
    clearInterval(state.statusRenderLoop);
    state.statusRenderLoop = null;
  }
};

const showStatus = async () => {
  await ensureSolanaUsdPrice();
  const profitUsd = getProfitUsd();
  const tokenName = await getTokenDisplayName();
  const stats = getRecentPriceStats();
  const performance = positionPerformance(state.position, state.currentPrice);
  const { position } = state;

  console.log('\nStatus dump:');
  row('bot running', state.botRunning ? 'yes' : 'no');
  row('mode', state.mode === 'sim' ? 'simulation' : 'live');
  row('feed', state.liveStreamReady ? 'connected' : 'idle');
  row('mint', state.mint || '<none>');
  row('price calls', state.pumpPortalApiCalls);
  row('last api call', lastApiCallLabel());
  row('api key', state.apiKey ? 'loaded' : 'missing');
  row('wallet key', state.publicWallet ? 'loaded' : 'missing');
  row('strategy', state.strategy);
  row('strategy info', describeStrategy(state.strategy));
  row('interval', intervalLabel());
  row('buy amount', buyAmountLabel());
  row('price trend', stats.changePct.toFixed(3) + '%');
  row('price avg', formatPrice(stats.avg, 'SOL'));
  row('last price', formatPrice(state.currentPrice, 'SOL'));
  row('avg cost basis', formatPrice(position.averageCostSol, 'SOL/token'));
  row('tokens', formatSolAmount(position.tokens, 9) + ' ' + tokenName);
  row('total cost', formatSolAmount(position.totalCostSol, 9) + ' SOL');
  row('realized PnL', formatSolAmount(position.realizedPnL, 9) + ' SOL');
  row('unrealized PnL', formatSolAmount(unrealizedPnl(position, state.currentPrice), 9) + ' SOL');
  row('unrealized gain', performance.pct === null || performance.multiple === null ? 'n/a' : formatPercent(performance.pct) + ' / ' + performance.multiple.toFixed(2) + 'x');
  console.log('  -------------------');
  row('profit', profitUsd === null ? 'n/a' : formatMoney(profitUsd) + ' USD');
  row('holdings', position.tokens > 0 ? formatMoney((position.tokens * Number(state.currentPrice || 0)) * state.solanaUsdPrice) + ' USD' : '$0.00 USD');
};

const showStrategy = () => {
  const stats = getRecentPriceStats();
  console.log('\nPosition snapshot');
  row('trading', state.botRunning ? 'yes' : 'no');
  row('feed', state.liveStreamReady ? 'connected' : 'idle');
  row('mint', state.mint || '<none>');
  row('price calls', state.pumpPortalApiCalls);
  row('last api call', lastApiCallLabel());
  row('interval', intervalLabel());
  row('buy amount', buyAmountLabel());
  row('price trend', stats.changePct.toFixed(3) + '%');
  row('price avg', formatPrice(stats.avg, 'SOL'));
  row('strategy', state.strategy);
  row('strategy info', describeStrategy(state.strategy));
};

module.exports = {
  renderStatusBanner,
  startStatusRenderLoop,
  stopStatusRenderLoop,
  showStatus,
  showStrategy,
};
