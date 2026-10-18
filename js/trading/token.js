const { state } = require('../state');
const { getTokenDisplayNameForMint } = require('../api/pumpfun');

const getCurrentTokenSymbol = () => {
  if (state.currentTokenSymbol) {
    return state.currentTokenSymbol.toUpperCase();
  }
  if (state.mint) {
    return state.mint.slice(0, 4).toUpperCase();
  }
  return 'NONE';
};

const refreshCurrentTokenSymbol = async () => {
  if (!state.mint) {
    state.currentTokenSymbol = '';
    return;
  }

  const symbol = await getTokenDisplayNameForMint(state.mint);
  if (symbol) {
    state.currentTokenSymbol = symbol;
  }
};

module.exports = { getCurrentTokenSymbol, refreshCurrentTokenSymbol };
