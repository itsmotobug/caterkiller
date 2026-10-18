const readline = require('readline');
const { state } = require('../state');
const { cleanupRealtimeSocket } = require('../api/stream');
const { handleLiveConfirmation } = require('../trading/mode');
const { resetPromptPrefix } = require('../ui/prompt');
const { dispatch, CLOSE } = require('./commands');

const handleInput = (input) => (state.liveConfirmationPending ? handleLiveConfirmation(input) : dispatch(input));

const startRepl = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  state.rl = rl;
  resetPromptPrefix();
  rl.prompt();

  // Serialize lines so a slow command finishes before the next one runs.
  let queue = Promise.resolve();
  let exiting = false;
  let closed = false;

  const step = async (raw) => {
    if (exiting) return;

    const input = String(raw || '').trim();
    const result = input ? await handleInput(input) : undefined;

    if (result === CLOSE) {
      exiting = true;
      rl.close();
      return;
    }

    if (!closed) rl.prompt();
  };

  rl.on('line', (raw) => {
    queue = queue.then(() => step(raw));
  });

  // Stdin can hit EOF before queued lines run, so drain the queue before exiting.
  rl.on('close', () => {
    closed = true;
    queue.finally(() => {
      cleanupRealtimeSocket();
      process.exit(0);
    });
  });
};

module.exports = { startRepl };
