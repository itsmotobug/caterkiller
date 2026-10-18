const { state } = require('../state');
const { ENDPOINTS } = require('../config');
const { recordPumpPortalCall } = require('./pumpfun');

const tradeRequest = async (action, mint, amount, denominatedInSol, slippage = 10) => {
  if (!state.apiKey) {
    console.log('Missing PUMP_API_KEY in .env');
    return null;
  }

  const body = {
    action,
    mint,
    amount,
    denominatedInSol: String(denominatedInSol),
    slippage,
    priorityFee: 0.00005,
    pool: 'pump',
    skipPreflight: false,
  };

  recordPumpPortalCall();
  const res = await fetch(ENDPOINTS.trade + encodeURIComponent(state.apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log('PumpPortal error: ' + JSON.stringify(json));
    return null;
  }

  return json;
};

module.exports = { tradeRequest };
