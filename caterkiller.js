#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STRATEGIES = {
  dca: 'Buy on a fixed interval. Simple dollar-cost averaging instead of price-signal chasing.',
  momentum: 'Buy when price is rising. Sell if price falls below the last mark.',
  meanReversion: 'Buy on dips, sell when price is stretched upward.',
  breakout: 'Buy when price breaks above the last local high.',
};

const PLACEHOLDER_DEFAULTS = {
  SOL_PRICE: 0.000001,
  DCA_SOL: 0.01,
  BUY_SOL: 0.01,
};

const envPath = path.join(__dirname, '.env');
const ANSI = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[32m', // '\x1b[36m',
  magenta: '\x1b[35m',
};

function colorize(text, code) {
  if (!process.stdout || !process.stdout.isTTY || process.env.NO_COLOR) {
    return text;
  }
  return code + text + ANSI.reset;
}

function logInfo(message) {
  console.log(colorize(message, ANSI.cyan));
}

function logSuccess(message) {
  console.log(colorize(message, ANSI.green));
}

function logError(message) {
  console.log(colorize(message, ANSI.red));
}

function logWarning(message) {
  console.log(colorize(message, ANSI.yellow));
}

const state = {
  mint: '',
  strategy: 'dca',
  botRunning: false,
  mode: 'sim',
  liveConfirmationPending: false,
  apiKey: '',
  publicWallet: '',
  currentPrice: null,
  lastPrice: null,
  solanaUsdPrice: null,
  priceHistory: [],
  lastSignalAt: 0,
  lastWsEventAt: 0,
  currentTokenSymbol: '',
  strategyCooldownMs: 10 * 1000,
  dcaIntervalMs: 60 * 1000,
  buyAmountSol: PLACEHOLDER_DEFAULTS.DCA_SOL,
  dcaLastBuyAt: 0,
  pumpPortalApiCalls: 0,
  lastPumpPortalApiCallAt: null,
  statusRenderThrottleMs: 3000,
  lastStatusRenderAt: 0,
  statusRenderLoop: null,
  rl: null,
  position: {
    tokens: 0,
    totalCostSol: 0,
    averageCostSol: 0,
    realizedPnL: 0,
    closedTrades: 0,
  },
  websocket: null,
  liveStreamReady: false,
  debug: false,
  shuttingDown: false,
  lastSubscribedMint: '',
  sessionEventCount: 0,
  apiFeeEventCount: 0,
  metaFilePath: path.join(__dirname, '.api_fees'),
};

function loadPersistedApiFeeSummary() {
  try {
    if (!fs.existsSync(state.metaFilePath)) {
      return;
    }

    const raw = fs.readFileSync(state.metaFilePath, 'utf8');
    const match = raw.match(/(?:events_received|messages_received):\s*([0-9]+)/i);
    if (!match) {
      return;
    }

    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0) {
      state.apiFeeEventCount = value;
    }
  } catch (error) {
    // Ignore unreadable or stale metadata; start from zero.
  }
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function loadEnv(filePath) {
  const data = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const env = {};

  for (const line of data.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    env[key] = value;
  }

  return env;
}

function writeEnvValue(key, value) {
  const normalizedKey = String(key || '').trim();
  const normalizedValue = String(value == null ? '' : value).trim();

  if (!normalizedKey) {
    return false;
  }

  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  let updated = false;

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }

    const index = trimmed.indexOf('=');
    const entryKey = trimmed.slice(0, index).trim();
    if (entryKey !== normalizedKey) {
      return line;
    }

    updated = true;
    return normalizedKey + '=' + normalizedValue;
  });

  if (!updated) {
    nextLines.push(normalizedKey + '=' + normalizedValue);
  }

  fs.writeFileSync(envPath, nextLines.join('\n') + '\n', 'utf8');
  return true;
}

function normalizeMode(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'live' || value === 'real') return 'live';
  if (value === 'sim' || value === 'simulation' || value === 'dry' || value === 'dry-run') return 'sim';
  return null;
}

function resetPromptPrefix() {
  if (state.rl) {
    state.rl.setPrompt('caterkiller (' + (state.mode === 'sim' ? 'simulation' : 'live') + ' / ' + state.strategy + ' / ' + (state.botRunning ? 'running' : 'stopped') + ')> ');
  }
}

function promptForLiveConfirmation() {
  if (!state.rl) {
    return;
  }
  state.rl.setPrompt('type arm to go live> ');
}

function setMode(mode) {
  const next = normalizeMode(mode);
  if (!next) {
    logError('Usage: live on|off');
    return;
  }

  if (next === 'live') {
    state.mode = 'sim';
    state.liveConfirmationPending = true;
    promptForLiveConfirmation();
    logWarning('Going live. Type `arm` to confirm.');
    return;
  }

  state.mode = 'sim';
  state.liveConfirmationPending = false;
  resetPromptPrefix();
  logSuccess('Mode set to: sim');
}

function fillStateFromEnv() {
  const env = loadEnv(envPath);
  state.strategy = (env.STRATEGY || 'dca').trim().toLowerCase();
  if (env.MODE) {
    setMode(env.MODE);
  } else if (parseBoolean(env.TRADE || 'false')) {
    state.mode = 'live';
  } else if (parseBoolean(env.SIMULATION ?? 'true')) {
    state.mode = 'sim';
  }
  state.apiKey = (env.PUMP_API_KEY || '').trim();
  state.publicWallet = (env.PUBLIC_WALLET_KEY || '').trim();
  state.mint = (env.MINT || '').trim();
  state.dcaIntervalMs = Number(env.DCA_INTERVAL_MS || env.DCA_INTERVAL || 60000);
  state.buyAmountSol = Number(env.DCA_AMOUNT_SOL || env.DCA_AMOUNT || PLACEHOLDER_DEFAULTS.DCA_SOL);
  if (!Number.isFinite(state.dcaIntervalMs) || state.dcaIntervalMs <= 0) {
    state.dcaIntervalMs = 60 * 1000;
  }
  if (!Number.isFinite(state.buyAmountSol) || state.buyAmountSol <= 0) {
    state.buyAmountSol = PLACEHOLDER_DEFAULTS.DCA_SOL;
  }

  if (!env.STRATEGY && !env.WATCHLIST) {
    state.strategy = 'dca';
  }
}

function printHelp() {
  console.log('\nCommands:');
  console.log('  <MINT>              Set the current mint address');
  console.log('  live                Toggle live mode on/off');
  console.log('  buy [SOL]           Buy the current mint using SOL amount');
  console.log('  buyamt [SOL]        Set the strategy buy amount (used by DCA / auto buys)');
  console.log('  sell [PERCENT]      Sell 100% of the current mint position');
  console.log('  wallet              Show the current SOL balance for the configured wallet');
  console.log('  mcap                Show the current mint market cap from PumpPortal/Pump.fun');
  console.log('  pos                 Show current position, bot state, and account snapshot');
  console.log('  strategy [NAME]     Set the active strategy');
  console.log('  dbg                 Toggle verbose trade-signal logging');
  console.log('  start               Start the active strategy');
  console.log('  stop                Stop the active strategy');
  console.log('  help                Show this help section');
  console.log('  exit                Quit Caterkiller');
}

function banner() {
  console.log('========================================');
  console.log('Caterkiller  v0.1');
  console.log('Minimal Pump.fun trading bot');
  console.log('========================================');
}

function isMintLike(value) {
  return /^[A-Za-z0-9]{32,44}$/.test(String(value || '').trim());
}

function round(value, precision = 6) {
  const multiplier = 10 ** precision;
  return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

function formatSolAmount(value, precision = 9) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return 'n/a';
  }

  const formatted = num.toFixed(precision);
  return formatted.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function extractPrice(event) {
  if (!event || typeof event !== 'object') return 0;

  if (Array.isArray(event)) {
    for (const entry of event) {
      const found = extractPrice(entry);
      if (found > 0) return found;
    }
    return 0;
  }

  const directPrice = Number(event.price ?? event.solPrice ?? event.tokenPrice ?? event.lastPrice ?? event.currentPrice);
  if (Number.isFinite(directPrice) && directPrice > 0) {
    return directPrice;
  }

  const solAmount = Number(event.solAmount ?? event.amountSol ?? event.amount_sol);
  const tokenAmount = Number(event.tokenAmount ?? event.token_amount ?? event.tokens ?? event.amountOut ?? event.amount_out);
  if (Number.isFinite(solAmount) && solAmount > 0 && Number.isFinite(tokenAmount) && tokenAmount > 0) {
    return solAmount / tokenAmount;
  }

  const nestedCandidates = ['data', 'payload', 'message', 'result'];
  for (const key of nestedCandidates) {
    const nested = event[key];
    if (nested && typeof nested === 'object') {
      const found = extractPrice(nested);
      if (found > 0) return found;
    }
  }

  return 0;
}

function updatePosition(action, amountSol, tokenQty, pricePerToken) {
  if (action === 'buy') {
    const tokens = Number(tokenQty) || 0;
    const sol = Number(amountSol) || 0;
    state.position.tokens += tokens;
    state.position.totalCostSol += sol;
    state.position.averageCostSol = state.position.tokens > 0 ? state.position.totalCostSol / state.position.tokens : 0;
    state.position.closedTrades += 1;
    return;
  }

  if (action === 'sell') {
    const tokens = Math.min(Number(tokenQty) || 0, state.position.tokens);
    const value = Number(pricePerToken || state.currentPrice || 0) * tokens;
    const costBasis = state.position.averageCostSol * tokens;
    state.position.realizedPnL += value - costBasis;
    state.position.tokens = Math.max(0, state.position.tokens - tokens);
    state.position.totalCostSol = state.position.tokens > 0 ? state.position.averageCostSol * state.position.tokens : 0;
    state.position.closedTrades += 1;
  }
}

function recalcPnL() {
  if (!state.position.tokens || !Number.isFinite(Number(state.currentPrice))) {
    return 0;
  }

  const currentValue = Number(state.currentPrice) * state.position.tokens;
  return currentValue - state.position.totalCostSol;
}

function formatPrice(value, unit = 'SOL') {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 'no price';
  }
  return formatSolAmount(num, 9) + ' ' + unit;
}

function formatCachedPrice() {
  return formatPrice(state.currentPrice, 'SOL');
}

function getCurrentTokenSymbol() {
  if (state.currentTokenSymbol) {
    return state.currentTokenSymbol.toUpperCase();
  }
  if (state.mint) {
    return state.mint.slice(0, 4).toUpperCase();
  }
  return 'NONE';
}

async function refreshCurrentTokenSymbol() {
  if (!state.mint) {
    state.currentTokenSymbol = '';
    return;
  }

  const symbol = await getTokenDisplayNameForMint(state.mint);
  if (symbol) {
    state.currentTokenSymbol = symbol;
  }
}

function renderStatusBanner(force = false) {
  if (state.liveConfirmationPending) {
    return;
  }

  if (state.rl && typeof state.rl.line === 'string' && state.rl.line.length > 0) {
    return;
  }

  const now = Date.now();
  if (!force && now - state.lastStatusRenderAt < state.statusRenderThrottleMs) {
    return;
  }

  const price = formatCachedPrice();
  const ageSeconds = state.lastWsEventAt ? Math.max(0, Math.round((Date.now() - state.lastWsEventAt) / 1000)) : 0;
  const feed = state.liveStreamReady ? 'LIVE' : 'IDLE';
  const mode = state.botRunning ? 'AUTO' : 'MANUAL';
  const token = getCurrentTokenSymbol();
  const message = 'Trading ' + token + ' | ' + price + ' | last event received (' + ageSeconds + 's ago) | ws events since startup ' + state.sessionEventCount;
  console.log(colorize(message, ANSI.magenta));
  state.lastStatusRenderAt = now;
}

function startStatusRenderLoop() {
  if (state.statusRenderLoop) {
    return;
  }

  state.statusRenderLoop = setInterval(() => {
    if (state.liveConfirmationPending) {
      return;
    }
    if (!state.liveStreamReady || !state.mint) {
      return;
    }
    if (state.rl && typeof state.rl.line === 'string' && state.rl.line.length > 0) {
      return;
    }
    renderStatusBanner();
  }, 5000);
}

function stopStatusRenderLoop() {
  if (state.statusRenderLoop) {
    clearInterval(state.statusRenderLoop);
    state.statusRenderLoop = null;
  }
}

async function getWalletBalance() {
  if (!state.publicWallet) {
    console.log('Missing PUBLIC_WALLET_KEY in .env');
    return null;
  }

  try {
    const rpcResponse = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [state.publicWallet],
      }),
    });

    const json = await rpcResponse.json();
    if (!json || json.error) {
      console.log('RPC balance error: ' + JSON.stringify(json && json.error ? json.error : json));
      return null;
    }

    const lamports = Number(json.result && json.result.value);
    if (!Number.isFinite(lamports)) {
      console.log('Balance unavailable.');
      return null;
    }

    const sol = lamports / 1_000_000_000;
    console.log('Wallet balance: ' + sol.toFixed(6) + ' SOL');
    return sol;
  } catch (error) {
    console.log('Balance lookup failed: ' + String(error.message || error));
    return null;
  }
}

function formatMoney(value, options = {}) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 'n/a';

  const minimumFractionDigits = Number.isFinite(options.minimumFractionDigits) ? options.minimumFractionDigits : 2;
  const maximumFractionDigits = Number.isFinite(options.maximumFractionDigits) ? options.maximumFractionDigits : 4;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);

  return sign + '$' + new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(abs);
}

function recordPumpPortalCall() {
  state.pumpPortalApiCalls += 1;
  state.lastPumpPortalApiCallAt = Date.now();
}

async function getMarketCap() {
  if (!state.mint) {
    console.log('Set a mint first with <MINT> or `mint <address>`');
    return null;
  }

  const url = 'https://frontend-api-v3.pump.fun/coins-v2/' + encodeURIComponent(state.mint);

  try {
    recordPumpPortalCall();
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (response.status === 429) {
      console.log('Pump.fun rate limited the MCAP lookup. Try again in a moment.');
      return null;
    }

    if (!response.ok) {
      console.log('MCAP unavailable for mint ' + state.mint + ' (HTTP ' + response.status + ').');
      return null;
    }

    const token = await response.json();
    const value = Number(token && (token.market_cap_usd ?? token.usd_market_cap ?? token.market_cap ?? token.market_cap_quote));

    if (!Number.isFinite(value)) {
      console.log('MCAP unavailable for mint ' + state.mint + '.');
      return null;
    }

    console.log('MCAP: ' + formatMoney(value) + ' | mint=' + state.mint);
    return value;
  } catch (error) {
    console.log('MCAP lookup failed: ' + String(error.message || error));
    return null;
  }
}

async function ensureSolanaUsdPrice() {
  if (Number.isFinite(state.solanaUsdPrice) && state.solanaUsdPrice > 0) {
    return state.solanaUsdPrice;
  }

  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    if (!response.ok) {
      state.solanaUsdPrice = 0;
      return 0;
    }
    const json = await response.json();
    const value = Number(json && json.solana && json.solana.usd);
    if (!Number.isFinite(value) || value <= 0) {
      state.solanaUsdPrice = 0;
      return 0;
    }
    state.solanaUsdPrice = value;
    return value;
  } catch (error) {
    state.solanaUsdPrice = 0;
    return 0;
  }
}

function getProfitUsd() {
  const pnlSol = Number((state.position.realizedPnL || 0) + (recalcPnL() || 0));
  if (!Number.isFinite(pnlSol)) {
    return null;
  }

  if (!Number.isFinite(state.solanaUsdPrice) || state.solanaUsdPrice <= 0) {
    return null;
  }

  return pnlSol * state.solanaUsdPrice;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value >= 0 ? '+' : '-';
  return sign + Math.abs(value).toFixed(2) + '%';
}

function getPositionPerformance() {
  const costBasis = Number(state.position.totalCostSol || 0);
  if (!Number.isFinite(costBasis) || costBasis <= 0) {
    return { pct: null, multiple: null };
  }

  const value = Number(state.currentPrice || 0) * Number(state.position.tokens || 0);
  const unrealizedPnL = value - costBasis;
  const pct = (unrealizedPnL / costBasis) * 100;
  const multiple = value / costBasis;

  return {
    pct: Number.isFinite(pct) ? pct : null,
    multiple: Number.isFinite(multiple) ? multiple : null,
  };
}

async function getTokenDisplayNameForMint(mint) {
  if (!mint) {
    return 'none';
  }

  try {
    const response = await fetch('https://frontend-api-v3.pump.fun/coins-v2/' + encodeURIComponent(mint), {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) {
      return mint.slice(0, 6).toUpperCase();
    }

    const payload = await response.json();
    return payload && payload.symbol ? payload.symbol : mint.slice(0, 6).toUpperCase();
  } catch (error) {
    return mint.slice(0, 6).toUpperCase();
  }
}

async function getTokenDisplayName() {
  return getTokenDisplayNameForMint(state.mint);
}

async function showStatus() {
  await ensureSolanaUsdPrice();
  const profitUsd = getProfitUsd();
  const tokenName = await getTokenDisplayName();
  const stats = getRecentPriceStats();
  const strategyInfo = STRATEGIES[state.strategy] || 'Custom strategy';
  const performance = getPositionPerformance();

  console.log('\nStatus dump:');
  console.log('  bot running:       ' + (state.botRunning ? 'yes' : 'no'));
  console.log('  mode:              ' + (state.mode === 'sim' ? 'simulation' : 'live'));
  console.log('  feed:              ' + (state.liveStreamReady ? 'connected' : 'idle'));
  console.log('  mint:              ' + (state.mint || '<none>'));
  console.log('  price calls:       ' + state.pumpPortalApiCalls);
  console.log('  last api call:     ' + (state.lastPumpPortalApiCallAt ? new Date(state.lastPumpPortalApiCallAt).toISOString() : 'never'));
  console.log('  api key:           ' + (state.apiKey ? 'loaded' : 'missing'));
  console.log('  wallet key:        ' + (state.publicWallet ? 'loaded' : 'missing'));
  console.log('  strategy:          ' + state.strategy);
  console.log('  strategy info:     ' + strategyInfo);
  console.log('  interval:          ' + (state.strategy === 'dca' ? (state.dcaIntervalMs / 1000) + 's' : 'n/a'));
  console.log('  buy amount:        ' + (Number.isFinite(state.buyAmountSol) && state.buyAmountSol > 0 ? state.buyAmountSol + ' SOL' : 'n/a'));
  console.log('  price trend:       ' + stats.changePct.toFixed(3) + '%');
  console.log('  price avg:         ' + formatPrice(stats.avg, 'SOL'));
  console.log('  last price:        ' + formatPrice(state.currentPrice, 'SOL'));
  console.log('  avg cost basis:    ' + formatPrice(state.position.averageCostSol, 'SOL/token'));
  console.log('  tokens:            ' + formatSolAmount(state.position.tokens, 9) + ' ' + tokenName);
  console.log('  total cost:        ' + formatSolAmount(state.position.totalCostSol, 9) + ' SOL');
  console.log('  realized PnL:      ' + formatSolAmount(state.position.realizedPnL, 9) + ' SOL');
  console.log('  unrealized PnL:    ' + formatSolAmount(recalcPnL(), 9) + ' SOL');
  console.log('  unrealized gain:   ' + (performance.pct === null || performance.multiple === null ? 'n/a' : formatPercent(performance.pct) + ' / ' + performance.multiple.toFixed(2) + 'x'));
  console.log('  -------------------')
  console.log('  profit:            ' + (profitUsd === null ? 'n/a' : formatMoney(profitUsd, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' USD'));
  console.log('  holdings:          ' + (state.position.tokens > 0 ? formatMoney((state.position.tokens * Number(state.currentPrice || 0)) * state.solanaUsdPrice, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' USD' : '$0.00 USD'));
}

function getRecentPriceStats() {
  const prices = state.priceHistory.slice(-12);
  if (prices.length < 2) {
    return { avg: state.currentPrice || 0, last: state.currentPrice || 0, high: state.currentPrice || 0, low: state.currentPrice || 0, changePct: 0 };
  }

  const first = prices[0];
  const last = prices[prices.length - 1];
  const avg = prices.reduce((sum, value) => sum + Number(value || 0), 0) / prices.length;
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;

  return { avg, last, high, low, changePct };
}

function getSignalScore() {
  if (!state.currentPrice) {
    return 0;
  }

  const stats = getRecentPriceStats();
  const last = Number(state.currentPrice || 0);
  const prev = Number(state.lastPrice || stats.last || last);
  const momentumPct = prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const shortTrendPct = stats.avg > 0 ? ((last - stats.avg) / stats.avg) * 100 : 0;

  if (state.strategy === 'dca') {
    return 0;
  }

  if (state.strategy === 'momentum') {
    return momentumPct * 2 + shortTrendPct;
  }

  if (state.strategy === 'meanReversion') {
    return (stats.avg > 0 ? ((last - stats.avg) / stats.avg) * 100 : 0) * -1;
  }

  if (state.strategy === 'breakout') {
    const breakout = stats.high > 0 ? ((last - stats.high) / stats.high) * 100 : 0;
    return breakout * 10;
  }

  return 0;
}

function showStrategy() {
  const active = STRATEGIES[state.strategy] || 'Custom strategy';
  const stats = getRecentPriceStats();
  console.log('\nPosition snapshot');
  console.log('  trading:           ' + (state.botRunning ? 'yes' : 'no'));
  console.log('  feed:              ' + (state.liveStreamReady ? 'connected' : 'idle'));
  console.log('  mint:              ' + (state.mint || '<none>'));
  console.log('  price calls:       ' + state.pumpPortalApiCalls);
  console.log('  last api call:     ' + (state.lastPumpPortalApiCallAt ? new Date(state.lastPumpPortalApiCallAt).toISOString() : 'never'));
  console.log('  interval:          ' + (state.strategy === 'dca' ? (state.dcaIntervalMs / 1000) + 's' : 'n/a'));
  console.log('  buy amount:        ' + (Number.isFinite(state.buyAmountSol) && state.buyAmountSol > 0 ? state.buyAmountSol + ' SOL' : 'n/a'));
  console.log('  price trend:       ' + stats.changePct.toFixed(3) + '%');
  console.log('  price avg:         ' + formatPrice(stats.avg, 'SOL'));
  console.log('  strategy:          ' + state.strategy);
  console.log('  strategy info:     ' + active);
}

function setStrategy(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key || !STRATEGIES[key]) {
    logError('Unknown strategy. Available: ' + Object.keys(STRATEGIES).join(', '));
    return;
  }
  state.strategy = key;
  if (state.strategy === 'dca') {
    state.dcaLastBuyAt = 0;
  }
  if (state.rl) {
    resetPromptPrefix();
  }
  logInfo('Strategy set to: ' + key);
}

function startStrategy(name) {
  const key = String(name || '').trim().toLowerCase() || state.strategy;
  if (!STRATEGIES[key]) {
    logError('Unknown strategy. Available: ' + Object.keys(STRATEGIES).join(', '));
    return;
  }

  if (state.botRunning) {
    logWarning('Bot already running.');
    return;
  }

  state.strategy = key;
  state.botRunning = true;
  if (state.strategy === 'dca') {
    state.dcaLastBuyAt = 0;
  }
  if (state.rl) {
    resetPromptPrefix();
  }
  logSuccess('Bot started.');
}

function stopStrategy() {
  if (!state.botRunning) {
    logWarning('Nothing to stop, not running.');
    return;
  }

  state.botRunning = false;
  if (state.rl) {
    resetPromptPrefix();
  }
  logInfo('Bot stopped.');
}

async function tradeRequest(action, mint, amount, denominatedInSol, slippage = 10) {
  if (!state.apiKey) {
    console.log('Missing PUMP_API_KEY in .env');
    return null;
  }

  const body = {
    action,
    mint,
    amount,
    denominatedInSol: String(denominatedInSol),
    slippage,
    priorityFee: 0.00005,
    pool: 'pump',
    skipPreflight: false,
  };

  const url = 'https://pumpportal.fun/api/trade?api-key=' + encodeURIComponent(state.apiKey);
  recordPumpPortalCall();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log('PumpPortal error: ' + JSON.stringify(json));
    return null;
  }

  return json;
}

async function buy(solAmount) {
  if (!state.mint) {
    console.log('Set a mint first with <MINT> or `mint <address>`');
    return;
  }

  const amount = Number(solAmount) || PLACEHOLDER_DEFAULTS.BUY_SOL;
  const quotePrice = state.currentPrice || PLACEHOLDER_DEFAULTS.SOL_PRICE;
  const tokens = amount / quotePrice;

  if (state.mode !== 'live') {
    console.log('Simulation buy: ' + amount + ' SOL on mint ' + state.mint);
    updatePosition('buy', amount, tokens, quotePrice);
    state.currentPrice = state.currentPrice || quotePrice;
    console.log('  cost basis: ' + formatPrice(state.position.averageCostSol, 'SOL/token'));
    console.log('  PnL now: ' + formatSolAmount(recalcPnL(), 9) + ' SOL');
    return { fake: true };
  }

  console.log('Real buy: ' + amount + ' SOL on mint ' + state.mint);
  const result = await tradeRequest('buy', state.mint, amount, true, 10);
  if (result && result.signature) {
    updatePosition('buy', amount, tokens, quotePrice);
  }
  return result;
}

async function sell(sellPercent = 100) {
  if (!state.mint) {
    console.log('Set a mint first with <MINT> or `mint <address>`');
    return;
  }

  const total = state.position.tokens || 0;
  const percent = Number(sellPercent) || 100;
  const targetTokens = total * (percent / 100);
  const price = state.currentPrice || state.position.averageCostSol || PLACEHOLDER_DEFAULTS.SOL_PRICE;

  if (state.mode !== 'live') {
    console.log('Simulation sell: ' + percent + '% of current mint position');
    updatePosition('sell', 0, targetTokens, price);
    console.log('  remaining tokens: ' + round(state.position.tokens, 6));
    console.log('  realized PnL: ' + round(state.position.realizedPnL, 6) + ' SOL');
    return { fake: true };
  }

  console.log('Real sell: ' + percent + '% of current mint position');
  const result = await tradeRequest('sell', state.mint, '100%', false, 10);
  if (result && result.signature) {
    updatePosition('sell', 0, targetTokens, price);
  }
  return result;
}

function debugTradeSignal(message) {
  if (!state.debug) return;
  console.log('[debug] ' + message);
}

function logStrategyAction(action, amountSol) {
  const readableAmount = Number.isFinite(Number(amountSol)) ? Number(amountSol).toFixed(6) + ' SOL' : 'configured amount';
  const summary = '[strategy] ' + state.strategy + ' -> ' + action.toUpperCase() + ' ' + readableAmount;
  debugTradeSignal(summary + ' | price=' + (state.currentPrice != null ? state.currentPrice : 'n/a') + ' | last=' + (state.lastPrice != null ? state.lastPrice : 'n/a'));
  console.log(summary);
}

function recordPriceSample(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return;
  }

  state.priceHistory.push(Number(value));
  if (state.priceHistory.length > 20) {
    state.priceHistory.shift();
  }
}

function evaluateSignal() {
  if (state.strategy === 'dca') {
    const knownPrice = Number(state.currentPrice || state.lastPrice || 0);
    if (!Number.isFinite(knownPrice) || knownPrice <= 0) {
      return null;
    }

    const now = Date.now();
    if (!state.dcaLastBuyAt) {
      state.dcaLastBuyAt = now;
      return 'buy';
    }

    if (now - state.dcaLastBuyAt >= state.dcaIntervalMs) {
      state.dcaLastBuyAt = now;
      return 'buy';
    }

    return null;
  }

  if (!state.currentPrice) {
    return null;
  }

  recordPriceSample(state.currentPrice);

  const score = getSignalScore();
  const now = Date.now();
  if (state.lastSignalAt && now - state.lastSignalAt < state.strategyCooldownMs) {
    return null;
  }

  if (state.strategy === 'momentum') {
    if (score >= 0.5) {
      state.lastSignalAt = now;
      return 'buy';
    }
    if (score <= -0.5) {
      state.lastSignalAt = now;
      return 'sell';
    }
  }

  if (state.strategy === 'meanReversion') {
    if (score >= 0.8) {
      state.lastSignalAt = now;
      return 'sell';
    }
    if (score <= -0.8) {
      state.lastSignalAt = now;
      return 'buy';
    }
  }

  if (state.strategy === 'breakout') {
    if (score >= 1.0) {
      state.lastSignalAt = now;
      return 'buy';
    }
    if (score <= -1.0) {
      state.lastSignalAt = now;
      return 'sell';
    }
  }

  return null;
}

async function maybeAutoTrade() {
  if (!state.botRunning) {
    return;
  }

  if (!state.mint) {
    return;
  }

  const knownPrice = Number(state.currentPrice || state.lastPrice || 0);
  if (!Number.isFinite(knownPrice) || knownPrice <= 0) {
    return;
  }

  const signal = evaluateSignal();
  if (!signal) {
    if (state.debug) {
      debugTradeSignal('signal rejected: strategy=' + state.strategy + ' | price=' + (state.currentPrice != null ? state.currentPrice : 'n/a') + ' | last=' + (state.lastPrice != null ? state.lastPrice : 'n/a'));
    }
    return;
  }

  if (state.debug) {
    debugTradeSignal('trade signal accepted: strategy=' + state.strategy + ' | signal=' + signal + ' | price=' + (state.currentPrice != null ? state.currentPrice : 'n/a'));
  }

  if (signal === 'buy') {
    const amount = Number.isFinite(state.buyAmountSol) && state.buyAmountSol > 0 ? state.buyAmountSol : PLACEHOLDER_DEFAULTS.BUY_SOL;
    logStrategyAction('buy', amount);
    await buy(amount);
  }
  if (signal === 'sell' && state.position.tokens > 0) {
    logStrategyAction('sell', state.position.tokens > 0 ? 100 : 0);
    await sell(100);
  }
}

function syncMintSubscription() {
  const socket = state.websocket;
  if (!socket || socket.readyState !== 1) {
    return;
  }

  const currentMint = String(state.mint || '').trim();
  if (!currentMint) {
    return;
  }

  if (state.lastSubscribedMint && state.lastSubscribedMint !== currentMint) {
    try {
      socket.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [state.lastSubscribedMint] }));
    } catch (error) {
      // Ignore unsubscribe race conditions while switching mints.
    }
  }

  if (state.lastSubscribedMint !== currentMint) {
    try {
      socket.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [currentMint] }));
      state.lastSubscribedMint = currentMint;
    } catch (error) {
      // Ignore race conditions during a mint switch.
    }
  }
}

function writeMetaSnapshot(reason = 'tick') {
  const sessionEvents = Number(state.sessionEventCount || 0);
  const totalEvents = Number(state.apiFeeEventCount || 0) + sessionEvents;
  const approxUsd = totalEvents * (1 / 10000);
  const yaml = [
    'events_received: ' + totalEvents,
    'estimated_usd: ' + round(approxUsd, 6),
    'billing_rule: "$1 per 10000 events"',
    'api_fee_estimate_usd: ' + round(approxUsd, 6),
    'last_updated: ' + new Date().toISOString(),
    'last_reason: ' + reason,
    'session_events_since_startup: ' + sessionEvents,
    'updated_in_realtime: true',
    'file_purpose: websocket fee logging snapshot',
    ''
  ].join('\n');

  state.apiFeeEventCount = totalEvents;

  try {
    fs.writeFileSync(state.metaFilePath, yaml, 'utf8');
  } catch (error) {
    console.log('Unable to write .meta: ' + String(error && error.message ? error.message : error));
  }
}

function cleanupRealtimeSocket() {
  if (!state.websocket || state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  console.log('Tearing down PumpPortal websocket connection cleanly...');
  writeMetaSnapshot('shutdown');

  try {
    if (state.mint && state.websocket.readyState === 1) {
      state.websocket.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [state.mint] }));
      console.log('Unsubscribed from mint:', state.mint);
    }
  } catch (error) {
    // Ignore unsubscribe race conditions during shutdown.
  }

  try {
    if (state.websocket.readyState === 1) {
      state.websocket.close();
      console.log('PumpPortal websocket closed.');
    }
  } catch (error) {
    // Ignore close race conditions during shutdown.
  }
}

async function connectRealtime() {
  if (!state.apiKey) {
    console.log('Live stream disabled: missing PUMP_API_KEY in .env');
    return null;
  }

  if (state.shuttingDown) {
    return null;
  }

  const WebSocketCtor = globalThis.WebSocket || require('ws');
  const url = 'wss://pumpportal.fun/api/data?api-key=' + encodeURIComponent(state.apiKey);

  const ws = new WebSocketCtor(url);

  ws.onopen = () => {
    state.liveStreamReady = true;
    state.shuttingDown = false;
    startStatusRenderLoop();
    console.log('Connected to PumpPortal realtime stream.');
    if (state.mint) {
      console.log('Subscribing to token trade for mint:', state.mint);
      syncMintSubscription();
    }
  };

  ws.onmessage = async (event) => {
    state.sessionEventCount += 1;
    state.lastWsEventAt = Date.now();
    writeMetaSnapshot('event');

    if (state.debug) {
      console.log('[ws] we got an event');
    }

    try {
      const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');

      if (!raw) {
        return;
      }

      if (state.debug) {
        console.log('[ws] raw event:', raw.slice(0, 1500));
      }

      const payload = JSON.parse(raw);
      const price = extractPrice(payload);
      if (!price || price <= 0) {
        if (state.debug) {
          debugTradeSignal('ws event ignored: no usable price in payload | keys=' + Object.keys(payload || {}).slice(0, 10).join(', '));
        }
        return;
      }

      state.lastPrice = Number(state.currentPrice) > 0 ? state.currentPrice : price;
      state.currentPrice = price;
      if (state.debug) {
        debugTradeSignal('ws price cached: ' + price + ' | keys=' + Object.keys(payload || {}).slice(0, 10).join(', '));
      }
      await maybeAutoTrade();
    } catch (error) {
      if (state.debug) {
        console.log('[ws] parse ignored:', String(error && error.message ? error.message : error));
      }
    }
  };

  ws.onclose = () => {
    state.liveStreamReady = false;
    stopStatusRenderLoop();
    if (!state.shuttingDown) {
      console.log('PumpPortal stream closed.');
      setTimeout(() => {
        if (!state.shuttingDown) {
          connectRealtime();
        }
      }, 5000);
    }
  };

  ws.onerror = (error) => {
    state.liveStreamReady = false;
    stopStatusRenderLoop();
    console.log('PumpPortal stream error: ' + String(error && error.message ? error.message : error));
    if (!state.shuttingDown) {
      setTimeout(() => {
        if (!state.shuttingDown) {
          connectRealtime();
        }
      }, 5000);
    }
  };

  state.websocket = ws;
  return ws;
}

async function commandLoop() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  state.rl = rl;

  resetPromptPrefix();
  rl.prompt();

  rl.on('line', async (raw) => {
    const input = String(raw || '').trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const lower = input.toLowerCase();

    if (state.liveConfirmationPending) {
      if (input.toUpperCase() === 'ARM') {
        state.mode = 'live';
        state.liveConfirmationPending = false;
        resetPromptPrefix();
        logSuccess('Mode set to: live');
      } else {
        state.liveConfirmationPending = false;
        resetPromptPrefix();
        logError('You did not type `arm`.');
      }
      rl.prompt();
      return;
    }

    if (lower === 'help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (lower === 'exit' || lower === 'quit') {
      console.log('Closing Caterkiller.');
      cleanupRealtimeSocket();
      rl.close();
      return;
    }

    if (lower === 'status' || lower === 'position' || lower === 'pos') {
      await showStatus();
      rl.prompt();
      return;
    }

    if (lower === 'wallet') {
      await getWalletBalance();
      rl.prompt();
      return;
    }

    if (lower === 'mcap') {
      await getMarketCap();
      rl.prompt();
      return;
    }

    if (lower === 'dbg') {
      state.debug = !state.debug;
      console.log('Verbose trade debug: ' + (state.debug ? 'on' : 'off'));
      rl.prompt();
      return;
    }

    if (lower === 'strategy' || lower === 'strat') {
      console.log('Available strategies: ' + Object.keys(STRATEGIES).join(', '));
      rl.prompt();
      return;
    }

    if (lower.startsWith('strategy ') || lower.startsWith('strat ')) {
      const name = input.slice(input.split(' ')[0].length + 1).trim();
      setStrategy(name);
      rl.prompt();
      return;
    }

    if (lower === 'start') {
      startStrategy();
      rl.prompt();
      return;
    }

    if (lower === 'stop') {
      stopStrategy();
      rl.prompt();
      return;
    }

    if (lower === 'live') {
      const nextMode = state.mode === 'live' ? 'sim' : 'live';
      setMode(nextMode);
      rl.prompt();
      return;
    }

    if (lower === 'live on') {
      setMode('live');
      rl.prompt();
      return;
    }

    if (lower === 'live off') {
      setMode('sim');
      rl.prompt();
      return;
    }

    if (lower === 'buy') {
      await buy(String(PLACEHOLDER_DEFAULTS.BUY_SOL));
      rl.prompt();
      return;
    }

    if (lower === 'buyamt') {
      console.log('Current buy amount: ' + state.buyAmountSol + ' SOL');
      rl.prompt();
      return;
    }

    if (lower.startsWith('buyamt ')) {
      const amount = input.slice('buyamt '.length).trim();
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        logError('Buy amount must be a positive number in SOL.');
      } else {
        state.buyAmountSol = parsed;
        state.strategy = state.strategy || 'dca';
        writeEnvValue('DCA_AMOUNT_SOL', parsed);
        console.log('Buy amount set to: ' + parsed + ' SOL');
      }
      rl.prompt();
      return;
    }

    if (lower.startsWith('buy ')) {
      const amount = input.slice('buy '.length).trim();
      await buy(amount || String(PLACEHOLDER_DEFAULTS.BUY_SOL));
      rl.prompt();
      return;
    }

    if (lower === 'sell') {
      await sell(100);
      rl.prompt();
      return;
    }

    if (lower.startsWith('sell ')) {
      const percent = input.slice('sell '.length).trim();
      await sell(percent || 100);
      rl.prompt();
      return;
    }

    if (isMintLike(input)) {
      const nextMint = input.trim();
      if (state.mint && nextMint === state.mint) {
        logWarning('Mint is already set to: ' + state.mint + ' — no change made.');
      } else {
        if (state.mint && nextMint !== state.mint && state.position.tokens > 0) {
          const coinSymbol = await getTokenDisplayNameForMint(state.mint);
          logWarning('Dumping existing holdings of ' + coinSymbol + '...');
          await sell(100);
        }
        state.mint = nextMint;
        state.currentTokenSymbol = '';
        await refreshCurrentTokenSymbol();
        writeEnvValue('MINT', nextMint);
        syncMintSubscription();
        console.log('Current mint set to: ' + state.mint);
      }
      rl.prompt();
      return;
    }

    if (lower.startsWith('mint ')) {
      const nextMint = input.slice(4).trim();
      if (state.mint && nextMint === state.mint) {
        logWarning('Mint is already set to: ' + state.mint + ' — no change made.');
      } else {
        if (state.mint && nextMint !== state.mint && state.position.tokens > 0) {
          const coinSymbol = await getTokenDisplayNameForMint(state.mint);
          logWarning('Dumping existing holdings of ' + coinSymbol + '...');
          await sell(100);
        }
        state.mint = nextMint;
        state.currentTokenSymbol = '';
        await refreshCurrentTokenSymbol();
        writeEnvValue('MINT', nextMint);
        syncMintSubscription();
        console.log('Current mint set to: ' + state.mint);
      }
      rl.prompt();
      return;
    }

    logWarning('Unknown command. Type `help` for commands.');
    rl.prompt();
  });

  rl.on('close', () => {
    cleanupRealtimeSocket();
    process.exit(0);
  });
}

process.once('SIGINT', () => {
  cleanupRealtimeSocket();
  process.exit(0);
});

process.once('SIGTERM', () => {
  cleanupRealtimeSocket();
  process.exit(0);
});

process.once('exit', () => {
  cleanupRealtimeSocket();
});

(async function start() {
  fillStateFromEnv();
  loadPersistedApiFeeSummary();
  if (state.mint) {
    await refreshCurrentTokenSymbol();
  }
  writeMetaSnapshot('boot');
  banner();
  printHelp();
  if (state.mint) {
    console.log('Booted with mint: ' + state.mint);
  } else if (state.apiKey || state.publicWallet) {
    console.log('Booted with mint: <none>');
  }
  await connectRealtime();
  await commandLoop();
})();
