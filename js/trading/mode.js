const { state } = require('../state');
const { logError, logSuccess, logWarning } = require('../log');
const { promptForLiveConfirmation, resetPromptPrefix } = require('../ui/prompt');

const LIVE_ALIASES = ['live', 'real'];
const SIM_ALIASES = ['sim', 'simulation', 'dry', 'dry-run'];

const normalizeMode = (raw) => {
  const value = String(raw || '').trim().toLowerCase();
  if (LIVE_ALIASES.includes(value)) return 'live';
  if (SIM_ALIASES.includes(value)) return 'sim';
  return null;
};

const setMode = (mode) => {
  const next = normalizeMode(mode);
  if (!next) {
    logError('Usage: live on|off');
    return;
  }

  if (next === 'live') {
    // Stays in sim until `arm` is typed; see handleLiveConfirmation.
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
};

const handleLiveConfirmation = (input) => {
  if (input.toUpperCase() === 'ARM') {
    state.mode = 'live';
    state.liveConfirmationPending = false;
    resetPromptPrefix();
    logSuccess('Mode set to: live');
    return;
  }

  state.liveConfirmationPending = false;
  resetPromptPrefix();
  logError('You did not type `arm`.');
};

module.exports = { setMode, handleLiveConfirmation };
