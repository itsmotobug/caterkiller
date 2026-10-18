const { state } = require('../state');
const { ENDPOINTS, LAMPORTS_PER_SOL } = require('../config');
const { lamportsToSol } = require('../math');

const ensureSolanaUsdPrice = async () => {
  if (Number.isFinite(state.solanaUsdPrice) && state.solanaUsdPrice > 0) {
    return state.solanaUsdPrice;
  }

  try {
    const response = await fetch(ENDPOINTS.solanaUsd);
    if (!response.ok) {
      state.solanaUsdPrice = 0;
      return 0;
    }

    const json = await response.json();
    const value = Number(json && json.solana && json.solana.usd);
    state.solanaUsdPrice = Number.isFinite(value) && value > 0 ? value : 0;
    return state.solanaUsdPrice;
  } catch (error) {
    state.solanaUsdPrice = 0;
    return 0;
  }
};

const getWalletBalance = async () => {
  if (!state.publicWallet) {
    console.log('Missing PUBLIC_WALLET_KEY in .env');
    return null;
  }

  try {
    const rpcResponse = await fetch(ENDPOINTS.solanaRpc, {
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

    const sol = lamportsToSol(lamports, LAMPORTS_PER_SOL);
    console.log('Wallet balance: ' + sol.toFixed(6) + ' SOL');
    return sol;
  } catch (error) {
    console.log('Balance lookup failed: ' + String(error.message || error));
    return null;
  }
};

module.exports = { ensureSolanaUsdPrice, getWalletBalance };
