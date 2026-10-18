const { state } = require('../state');
const { ENDPOINTS, BROWSER_HEADERS } = require('../config');
const { formatMoney } = require('../format');

const recordPumpPortalCall = () => {
  state.pumpPortalApiCalls += 1;
  state.lastPumpPortalApiCallAt = Date.now();
};

const fetchCoin = (mint) => fetch(ENDPOINTS.coin + encodeURIComponent(mint), { headers: BROWSER_HEADERS });

const fallbackSymbol = (mint) => mint.slice(0, 6).toUpperCase();

const getTokenDisplayNameForMint = async (mint) => {
  if (!mint) {
    return 'none';
  }

  try {
    const response = await fetchCoin(mint);
    if (!response.ok) {
      return fallbackSymbol(mint);
    }

    const payload = await response.json();
    return payload && payload.symbol ? payload.symbol : fallbackSymbol(mint);
  } catch (error) {
    return fallbackSymbol(mint);
  }
};

const getTokenDisplayName = () => getTokenDisplayNameForMint(state.mint);

const getMarketCap = async () => {
  if (!state.mint) {
    console.log('Set a mint first with <MINT> or `mint <address>`');
    return null;
  }

  try {
    recordPumpPortalCall();
    const response = await fetchCoin(state.mint);

    if (response.status === 429) {
      console.log('Pump.fun rate limited the MCAP lookup. Try again in a moment.');
      return null;
    }

    if (!response.ok) {
      console.log('MCAP unavailable for mint ' + state.mint + ' (HTTP ' + response.status + ').');
      return null;
    }

    const token = await response.json();
    const value = Number(token && (token.market_cap_usd ?? token.usd_market_cap ?? token.market_cap ?? token.market_cap_quote));

    if (!Number.isFinite(value)) {
      console.log('MCAP unavailable for mint ' + state.mint + '.');
      return null;
    }

    console.log('MCAP: ' + formatMoney(value) + ' | mint=' + state.mint);
    return value;
  } catch (error) {
    console.log('MCAP lookup failed: ' + String(error.message || error));
    return null;
  }
};

module.exports = { recordPumpPortalCall, getTokenDisplayNameForMint, getTokenDisplayName, getMarketCap };
