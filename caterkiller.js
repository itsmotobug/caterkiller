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

const envPath = path.join(__dirname, '.env');
const state = {
  mint: '',
  strategy: 'dca',
  strategyRunning: false,
  trade: false,
  simulation: true,
  apiKey: '',
  publicWallet: '',
  currentPrice: null,
  lastPrice: null,
  dcaIntervalMs: 60 * 1000,
  dcaAmountSol: 0.01,
  dcaLastBuyAt: 0,
  tickerEnabled: false,
  tickerTimer: null,
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
};

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

function fillStateFromEnv() {
  const env = loadEnv(envPath);
  state.strategy = (env.STRATEGY || 'dca').trim().toLowerCase();
  state.trade = parseBoolean(env.TRADE || 'false');
  state.simulation = parseBoolean(env.SIMULATION ?? 'true');
  state.apiKey = (env.PUMP_API_KEY || '').trim();
  state.publicWallet = (env.PUBLIC_WALLET_KEY || '').trim();
  state.mint = (env.MINT || '').trim();
  state.dcaIntervalMs = Number(env.DCA_INTERVAL_MS || env.DCA_INTERVAL || 60000);
  state.dcaAmountSol = Number(env.DCA_AMOUNT_SOL || env.DCA_AMOUNT || 0.01);
  if (!Number.isFinite(state.dcaIntervalMs) || state.dcaIntervalMs <= 0) {
    state.dcaIntervalMs = 60 * 1000;
  }
  if (!Number.isFinite(state.dcaAmountSol) || state.dcaAmountSol <= 0) {
    state.dcaAmountSol = 0.01;
  }

  if (!env.STRATEGY && !env.WATCHLIST) {
    state.strategy = 'dca';
  }
}

function printHelp() {
  console.log('\nCommands:');
  console.log('  <MINT>              Set the current mint address');
  console.log('  buy [SOL]           Buy the current mint using SOL amount');
  console.log('  sell [PERCENT]      Sell 100% of the current mint position');
  console.log('  balance             Show the current SOL balance for the configured wallet');
  console.log('  mcap                Show the current mint market cap from PumpPortal/Pump.fun');
  console.log('  price [SOL]         Set or show the current token price for simulation');
  console.log('  ticker on|off       Toggle a live cached-price ticker');
  console.log('  status              Show wallet, strategy, holdings, and PnL');
  console.log('  strategy [NAME]     Set the active strategy (default: dca)');
  console.log('  start [NAME]        Start the active strategy');
  console.log('  stop                Stop the active strategy');
  console.log('  sim on|off          Enable or disable simulated execution');
  console.log('  trade on|off        Enable or disable real PumpPortal trading');
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

function extractPrice(event) {
  if (!event || typeof event !== 'object') return 0;

  const candidateKeys = [
    'price', 'solPrice', 'tokenPrice', 'token_price', 'amountSol', 'amount_sol',
    'solanaPrice', 'solana_price', 'usdPrice', 'marketPrice'
  ];

  for (const key of candidateKeys) {
    if (event[key] !== undefined && event[key] !== null && Number(event[key]) > 0) {
      return Number(event[key]);
    }
  }

  const nested = event.data || event.payload || event.message;
  if (nested && typeof nested === 'object') {
    return extractPrice(nested);
  }

  if (event.amount && event.amountOut) {
    return Number(event.amount) / Number(event.amountOut || 1);
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
  if (!state.position.tokens) {
    return 0;
  }

  const currentValue = state.currentPrice * state.position.tokens;
  return currentValue - state.position.totalCostSol + state.position.realizedPnL;
}

function formatCachedPrice() {
  const value = Number(state.currentPrice);
  if (!Number.isFinite(value) || value <= 0) {
    return 'no price';
  }
  return value.toFixed(6) + ' SOL';
}

function renderTickerLine() {
  const message = 'Ticker: ' + formatCachedPrice() + ' | mint=' + (state.mint || '<none>');
  if (state.rl && typeof state.rl.line === 'string' && state.rl.line.length > 0) {
    return;
  }
  console.log(message);
}

function renderStatusBanner() {
  if (state.rl && typeof state.rl.line === 'string' && state.rl.line.length > 0) {
    return;
  }

  const feed = state.liveStreamReady ? 'feed live' : 'feed idle';
  const mode = state.strategyRunning ? 'running' : 'stopped';
  const price = formatCachedPrice();
  const message = 'status: mode=' + mode + ' | ' + feed + ' | price=' + price + ' | mint=' + (state.mint || '<none>');
  console.log(message);
}

function renderStrategyTick() {
  if (!state.liveStreamReady || !state.mint) {
    return;
  }
  if (state.rl && typeof state.rl.line === 'string' && state.rl.line.length > 0) {
    return;
  }
  renderStatusBanner();
}

function setTicker(enabled) {
  state.tickerEnabled = enabled;

  if (enabled) {
    if (state.tickerTimer) return;
    state.tickerTimer = setInterval(() => {
      if (!state.tickerEnabled) return;
      renderStatusBanner();
    }, 2000);
    renderStatusBanner();
    return;
  }

  if (state.tickerTimer) {
    clearInterval(state.tickerTimer);
    state.tickerTimer = null;
  }
  console.log('Ticker disabled.');
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

function formatMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 'n/a';
  return '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

async function getMarketCap() {
  if (!state.mint) {
    console.log('Set a mint first with <MINT> or `mint <address>`');
    return null;
  }

  const url = 'https://frontend-api-v3.pump.fun/coins-v2/' + encodeURIComponent(state.mint);

  try {
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

function showStatus() {
  console.log('\nStatus');
  console.log('  strategy:          ' + state.strategy);
  console.log('  strategy running:  ' + (state.strategyRunning ? 'yes' : 'no'));
  console.log('  feed:              ' + (state.liveStreamReady ? 'live' : 'idle'));
  console.log('  mint:              ' + (state.mint || '<none>'));
  console.log('  simulation:        ' + (state.simulation ? 'on' : 'off'));
  console.log('  trade mode:        ' + (state.trade ? 'real trade on' : 'dry run'));
  console.log('  api key:           ' + (state.apiKey ? 'loaded' : 'missing'));
  console.log('  wallet key:        ' + (state.publicWallet ? 'loaded' : 'missing'));
  console.log('  last price:        ' + formatCachedPrice());
  console.log('  avg cost:          ' + round(state.position.averageCostSol, 6) + ' SOL/token');
  console.log('  tokens:            ' + round(state.position.tokens, 6));
  console.log('  total cost:        ' + round(state.position.totalCostSol, 6) + ' SOL');
  console.log('  realized PnL:      ' + round(state.position.realizedPnL, 6) + ' SOL');
  console.log('  unrealized PnL:    ' + round(recalcPnL(), 6) + ' SOL');
}

function showStrategy() {
  const active = STRATEGIES[state.strategy] || 'Custom strategy';
  console.log('\nStrategy');
  console.log('  active:            ' + state.strategy);
  console.log('  running:           ' + (state.strategyRunning ? 'yes' : 'no'));
  console.log('  feed:              ' + (state.liveStreamReady ? 'live' : 'idle'));
  console.log('  mint:              ' + (state.mint || '<none>'));
  console.log('  interval:          ' + (state.strategy === 'dca' ? (state.dcaIntervalMs / 1000) + 's' : 'n/a'));
  console.log('  buy amount:        ' + (state.strategy === 'dca' ? state.dcaAmountSol + ' SOL' : 'n/a'));
  console.log('  details:           ' + active);
}

function setStrategy(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key || !STRATEGIES[key]) {
    console.log('Unknown strategy. Available: ' + Object.keys(STRATEGIES).join(', '));
    return;
  }
  state.strategy = key;
  console.log('Strategy set to: ' + key);
}

function startStrategy(name) {
  const key = String(name || '').trim().toLowerCase() || state.strategy;
  if (!STRATEGIES[key]) {
    console.log('Unknown strategy. Available: ' + Object.keys(STRATEGIES).join(', '));
    return;
  }

  if (state.strategyRunning) {
    console.log('Strategy already running: ' + state.strategy);
    return;
  }

  state.strategy = key;
  state.strategyRunning = true;
  if (state.strategy === 'dca') {
    state.dcaLastBuyAt = 0;
  }
  console.log('Started strategy: ' + key);
}

function stopStrategy() {
  if (!state.strategyRunning) {
    console.log('Strategy is not running.');
    return;
  }

  state.strategyRunning = false;
  console.log('Stopped strategy.');
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

  const amount = Number(solAmount) || 0.01;
  const quotePrice = state.currentPrice || 0.000001;
  const tokens = amount / quotePrice;

  if (state.simulation || !state.trade) {
    console.log('Simulation buy: ' + amount + ' SOL on mint ' + state.mint);
    updatePosition('buy', amount, tokens, quotePrice);
    state.currentPrice = state.currentPrice || quotePrice;
    console.log('  avg cost: ' + round(state.position.averageCostSol, 6) + ' SOL/token');
    console.log('  pnl now: ' + round(recalcPnL(), 6) + ' SOL');
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
  const price = state.currentPrice || state.position.averageCostSol || 0.000001;

  if (state.simulation || !state.trade) {
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

function logStrategyAction(action, amountSol) {
  const readableAmount = Number.isFinite(Number(amountSol)) ? Number(amountSol).toFixed(6) + ' SOL' : 'configured amount';
  console.log('[strategy] ' + state.strategy + ' -> ' + action.toUpperCase() + ' ' + readableAmount);
}

function evaluateSignal() {
  if (state.strategy === 'dca') {
    if (!state.currentPrice) {
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

  if (!state.currentPrice || !state.lastPrice) {
    return null;
  }

  const delta = state.currentPrice - state.lastPrice;
  const pct = state.lastPrice > 0 ? (delta / state.lastPrice) * 100 : 0;

  if (state.strategy === 'momentum') {
    if (pct > 0.5) return 'buy';
    if (pct < -0.5) return 'sell';
  }

  if (state.strategy === 'meanReversion') {
    if (pct < -1.5) return 'buy';
    if (pct > 1.5) return 'sell';
  }

  if (state.strategy === 'breakout') {
    if (pct > 1.0) return 'buy';
    if (pct < -1.0) return 'sell';
  }

  return null;
}

async function maybeAutoTrade() {
  if (!state.strategyRunning) {
    return;
  }

  if (!state.mint) {
    return;
  }

  if (!state.currentPrice || state.lastPrice === 0) {
    return;
  }

  const signal = evaluateSignal();
  if (!signal) return;

  if (signal === 'buy') {
    const amount = state.strategy === 'dca' ? state.dcaAmountSol : 0.01;
    logStrategyAction('buy', amount);
    await buy(amount);
  }
  if (signal === 'sell' && state.position.tokens > 0) {
    logStrategyAction('sell', state.position.tokens > 0 ? 100 : 0);
    await sell(100);
  }
}

async function connectRealtime() {
  if (!state.apiKey) {
    console.log('Live stream disabled: missing PUMP_API_KEY in .env');
    return null;
  }

  let WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) {
    try {
      const wsModule = await import('ws');
      WebSocketCtor = wsModule.WebSocket;
    } catch (error) {
      console.log('Node WebSocket support is unavailable; live stream disabled.');
      return null;
    }
  }

  const ws = new WebSocketCtor('wss://pumpportal.fun/api/data?api-key=' + encodeURIComponent(state.apiKey));
  ws.addEventListener('open', () => {
    state.liveStreamReady = true;
    console.log('Connected to PumpPortal realtime stream.');
    if (state.mint) {
      ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [state.mint] }));
    }
  });

  ws.addEventListener('message', async (event) => {
    try {
      const payload = JSON.parse(String(event.data));
      const price = extractPrice(payload);
      if (price) {
        state.lastPrice = Number(state.currentPrice) > 0 ? state.currentPrice : price;
        state.currentPrice = price;
        if (state.tickerEnabled) {
          renderTickerLine();
        }
        await maybeAutoTrade();
        renderStrategyTick();
      }
    } catch (error) {
      // Ignore parsing noise from the stream.
    }
  });

  ws.addEventListener('close', () => {
    state.liveStreamReady = false;
    console.log('PumpPortal stream closed.');
  });

  ws.addEventListener('error', (error) => {
    state.liveStreamReady = false;
    console.log('PumpPortal stream error: ' + String(error.message || error));
  });

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

  rl.setPrompt('caterkiller> ');
  rl.prompt();

  rl.on('line', async (raw) => {
    const input = String(raw || '').trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const lower = input.toLowerCase();

    if (lower === 'help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (lower === 'exit' || lower === 'quit') {
      console.log('Closing Caterkiller.');
      rl.close();
      return;
    }

    if (lower === 'status') {
      showStatus();
      rl.prompt();
      return;
    }

    if (lower === 'balance') {
      await getWalletBalance();
      rl.prompt();
      return;
    }

    if (lower === 'mcap') {
      await getMarketCap();
      rl.prompt();
      return;
    }

    if (lower === 'ticker') {
      console.log('Ticker: ' + (state.tickerEnabled ? 'on' : 'off'));
      rl.prompt();
      return;
    }

    if (lower === 'ticker on') {
      setTicker(true);
      rl.prompt();
      return;
    }

    if (lower === 'ticker off') {
      setTicker(false);
      rl.prompt();
      return;
    }

    if (lower === 'price') {
      console.log('Current price: ' + formatCachedPrice());
      rl.prompt();
      return;
    }

    if (lower.startsWith('price ')) {
      const parsed = Number(input.slice('price '.length).trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.log('Usage: price [SOL]');
      } else {
        state.lastPrice = Number(state.currentPrice) > 0 ? state.currentPrice : parsed;
        state.currentPrice = parsed;
        if (state.tickerEnabled) {
          renderTickerLine();
        }
        console.log('Price set to: ' + parsed.toFixed(6) + ' SOL');
      }
      rl.prompt();
      return;
    }

    if (lower === 'strategy') {
      showStrategy();
      rl.prompt();
      return;
    }

    if (lower.startsWith('strategy ')) {
      const name = input.slice('strategy '.length).trim();
      setStrategy(name);
      rl.prompt();
      return;
    }

      if (lower === 'start') {
        startStrategy();
      rl.prompt();
      return;
    }

      if (lower.startsWith('start ')) {
      startStrategy(input.slice(input.indexOf(' ') + 1).trim());
      rl.prompt();
      return;
    }

      if (lower === 'stop') {
        stopStrategy();
      rl.prompt();
      return;
    }

      if (lower.startsWith('stop ')) {
        stopStrategy();
      rl.prompt();
      return;
    }

    if (lower === 'sim') {
      console.log('Simulation: ' + (state.simulation ? 'on' : 'off'));
      rl.prompt();
      return;
    }

    if (lower === 'sim on') {
      state.simulation = true;
      console.log('Simulation on.');
      rl.prompt();
      return;
    }

    if (lower === 'sim off') {
      state.simulation = false;
      console.log('Simulation off.');
      rl.prompt();
      return;
    }

    if (lower === 'trade') {
      console.log('Trade mode: ' + (state.trade ? 'on' : 'off'));
      rl.prompt();
      return;
    }

    if (lower === 'trade on') {
      state.trade = true;
      console.log('Real trade mode on.');
      rl.prompt();
      return;
    }

    if (lower === 'trade off') {
      state.trade = false;
      console.log('Real trade mode off.');
      rl.prompt();
      return;
    }

    if (lower === 'buy') {
      await buy('0.01');
      rl.prompt();
      return;
    }

    if (lower.startsWith('buy ')) {
      const amount = input.slice('buy '.length).trim();
      await buy(amount || '0.01');
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
      state.mint = input.trim();
      if (state.websocket) {
        state.websocket.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [state.mint] }));
      }
      console.log('Current mint set to: ' + state.mint);
      rl.prompt();
      return;
    }

    if (lower.startsWith('mint ')) {
      state.mint = input.slice(4).trim();
      console.log('Current mint set to: ' + state.mint);
      rl.prompt();
      return;
    }

    console.log('Unknown command. Type "help" for commands.');
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

(async function start() {
  fillStateFromEnv();
  banner();
  printHelp();
  if (state.mint) {
    console.log('Booted with mint: ' + state.mint);
  } else if (state.apiKey || state.publicWallet) {
    console.log('Booted with mint: <none>');
  }
  await connectRealtime();
  if (state.tickerEnabled) setTicker(true);
  await commandLoop();
})();
