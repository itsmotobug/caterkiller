const formatSolAmount = (value, precision = 9) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return 'n/a';
  }

  const formatted = num.toFixed(precision);
  return formatted.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
};

const formatPrice = (value, unit = 'SOL') => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 'no price';
  }
  return formatSolAmount(num, 9) + ' ' + unit;
};

const formatPercent = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value >= 0 ? '+' : '-';
  return sign + Math.abs(value).toFixed(2) + '%';
};

const formatMoney = (value, options = {}) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 'n/a';

  const minimumFractionDigits = Number.isFinite(options.minimumFractionDigits) ? options.minimumFractionDigits : 2;
  const maximumFractionDigits = Number.isFinite(options.maximumFractionDigits) ? options.maximumFractionDigits : 4;
  const sign = num < 0 ? '-' : '';

  return sign + '$' + new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(Math.abs(num));
};

module.exports = {
  formatSolAmount,
  formatPrice,
  formatPercent,
  formatMoney,
};
