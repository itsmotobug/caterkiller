const { state } = require('./state');

const ANSI = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[32m', // Intended as '\x1b[36m'; kept as-is to preserve output.
  magenta: '\x1b[35m',
};

const colorize = (text, code) => {
  if (!process.stdout || !process.stdout.isTTY || process.env.NO_COLOR) {
    return text;
  }
  return code + text + ANSI.reset;
};

const logInfo = (message) => console.log(colorize(message, ANSI.cyan));
const logSuccess = (message) => console.log(colorize(message, ANSI.green));
const logError = (message) => console.log(colorize(message, ANSI.red));
const logWarning = (message) => console.log(colorize(message, ANSI.yellow));
const logStatus = (message) => console.log(colorize(message, ANSI.magenta));

const debugTradeSignal = (message) => {
  if (!state.debug) return;
  console.log('[debug] ' + message);
};

module.exports = {
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logStatus,
  debugTradeSignal,
};
