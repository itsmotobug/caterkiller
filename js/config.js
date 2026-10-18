const path = require('path');

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

const LAMPORTS_PER_SOL = 1_000_000_000;

const ENV_PATH = path.join(__dirname, '..', '.env');

const ENDPOINTS = {
  coin: 'https://frontend-api-v3.pump.fun/coins-v2/',
  trade: 'https://pumpportal.fun/api/trade?api-key=',
  stream: 'wss://pumpportal.fun/api/data?api-key=',
  solanaRpc: 'https://api.mainnet-beta.solana.com',
  solanaUsd: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
};

const BROWSER_HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };

module.exports = {
  STRATEGIES,
  PLACEHOLDER_DEFAULTS,
  LAMPORTS_PER_SOL,
  ENV_PATH,
  ENDPOINTS,
  BROWSER_HEADERS,
};
