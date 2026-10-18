const { state } = require('../state');

const resetPromptPrefix = () => {
  if (!state.rl) {
    return;
  }
  state.rl.setPrompt('caterkiller (' + (state.mode === 'sim' ? 'simulation' : 'live') + ' / ' + state.strategy + ' / ' + (state.botRunning ? 'running' : 'stopped') + ')> ');
};

const promptForLiveConfirmation = () => {
  if (state.rl) {
    state.rl.setPrompt('type arm to go live> ');
  }
};

module.exports = { resetPromptPrefix, promptForLiveConfirmation };
