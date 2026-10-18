const { state } = require('./state');
const { fillStateFromEnv } = require('./settings');
const { refreshCurrentTokenSymbol } = require('./trading/token');
const { banner, printHelp } = require('./ui/help');
const { connectRealtime, cleanupRealtimeSocket } = require('./api/stream');
const { startRepl } = require('./cli/repl');

const registerShutdownHooks = () => {
  const shutdown = () => {
    cleanupRealtimeSocket();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('exit', () => cleanupRealtimeSocket());
};

const bootMessage = () => {
  if (state.mint) {
    return 'Booted with mint: ' + state.mint;
  }
  if (state.apiKey || state.publicWallet) {
    return 'Booted with mint: <none>';
  }
  return null;
};

const main = async () => {
  registerShutdownHooks();
  fillStateFromEnv();

  if (state.mint) {
    await refreshCurrentTokenSymbol();
  }

  banner();
  printHelp();

  const boot = bootMessage();
  if (boot) {
    console.log(boot);
  }

  await connectRealtime();
  startRepl();
};

module.exports = { main };
