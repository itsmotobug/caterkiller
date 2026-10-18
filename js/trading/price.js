const { ratio } = require('../math');

const SPOT_POOLS = [undefined, null, 'pump'];

// Bonding-curve reserves describe the pump pool only. Other pools (e.g. LetsBonk's
// solInPool/tokensInPool) use different fields, so they fall back to the trade's own price.
const extractTradePrice = (payload, mint) => {
  if (!payload || typeof payload !== 'object' || payload.mint !== mint) return 0;

  const execution = ratio(payload.solAmount, payload.tokenAmount);
  if (!SPOT_POOLS.includes(payload.pool)) return execution ?? 0;

  const spot = ratio(payload.vSolInBondingCurve, payload.vTokensInBondingCurve);
  return spot ?? execution ?? 0;
};

module.exports = { extractTradePrice };
