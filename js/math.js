const round = (value, precision = 6) => {
  const multiplier = 10 ** precision;
  return Math.round((Number(value) || 0) * multiplier) / multiplier;
};

const percentChange = (from, to) => (from > 0 ? ((to - from) / from) * 100 : 0);

const average = (values) => values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;

const ratio = (numerator, denominator) => {
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && top > 0 && bottom > 0 ? top / bottom : null;
};

const share = (total, percent) => total * (percent / 100);

const lamportsToSol = (lamports, lamportsPerSol) => lamports / lamportsPerSol;

module.exports = {
  round,
  percentChange,
  average,
  ratio,
  share,
  lamportsToSol,
};
