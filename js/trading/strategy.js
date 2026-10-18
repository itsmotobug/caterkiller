const { state } = require('../state');
const { STRATEGIES } = require('../config');
const { writeEnvValue } = require('../env');
const { logError, logInfo, logSuccess, logWarning } = require('../log');
const { resetPromptPrefix } = require('../ui/prompt');

const isKnownStrategy = (key) => Object.hasOwn(STRATEGIES, key);

const strategyNames = () => Object.keys(STRATEGIES).join(', ');

const describeStrategy = (key) => (isKnownStrategy(key) ? STRATEGIES[key] : 'Custom strategy');

const setStrategy = (name) => {
  const key = String(name || '').trim().toLowerCase();
  if (!key || !isKnownStrategy(key)) {
    logError('Unknown strategy. Available: ' + strategyNames());
    return;
  }

  state.strategy = key;
  writeEnvValue('STRATEGY', key);
  if (key === 'dca') {
    state.dcaLastBuyAt = 0;
  }
  if (state.rl) {
    resetPromptPrefix();
  }
  logInfo('Strategy set to: ' + key);
};

const startStrategy = (name) => {
  const key = String(name || '').trim().toLowerCase() || state.strategy;
  if (!isKnownStrategy(key)) {
    logError('Unknown strategy. Available: ' + strategyNames());
    return;
  }

  if (state.botRunning) {
    logWarning('Bot already running.');
    return;
  }

  state.strategy = key;
  state.botRunning = true;
  if (key === 'dca') {
    state.dcaLastBuyAt = 0;
  }
  if (state.rl) {
    resetPromptPrefix();
  }
  logSuccess('Bot started.');
};

const stopStrategy = () => {
  if (!state.botRunning) {
    logWarning('Nothing to stop, not running.');
    return;
  }

  state.botRunning = false;
  if (state.rl) {
    resetPromptPrefix();
  }
  logInfo('Bot stopped.');
};

module.exports = { strategyNames, describeStrategy, setStrategy, startStrategy, stopStrategy };
