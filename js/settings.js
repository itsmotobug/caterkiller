const { state } = require('./state');
const { PLACEHOLDER_DEFAULTS } = require('./config');
const { loadEnv, parseBoolean } = require('./env');
const { setMode } = require('./trading/mode');

const fillStateFromEnv = () => {
  const env = loadEnv();
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
};

module.exports = { fillStateFromEnv };
