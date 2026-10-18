const fs = require('fs');
const { ENV_PATH } = require('./config');

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
};

const isAssignmentLine = (trimmed) => Boolean(trimmed) && !trimmed.startsWith('#') && trimmed.includes('=');

const readLines = () => (fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : []);

const loadEnv = () =>
  readLines()
    .map((line) => line.trim())
    .filter(isAssignmentLine)
    .reduce((env, trimmed) => {
      const index = trimmed.indexOf('=');
      return { ...env, [trimmed.slice(0, index).trim()]: trimmed.slice(index + 1).trim() };
    }, {});

const writeEnvValue = (key, value) => {
  const normalizedKey = String(key || '').trim();
  const normalizedValue = String(value == null ? '' : value).trim();

  if (!normalizedKey) {
    return false;
  }

  let updated = false;
  const nextLines = readLines().map((line) => {
    const trimmed = line.trim();
    if (!isAssignmentLine(trimmed)) {
      return line;
    }

    const entryKey = trimmed.slice(0, trimmed.indexOf('=')).trim();
    if (entryKey !== normalizedKey) {
      return line;
    }

    updated = true;
    return normalizedKey + '=' + normalizedValue;
  });

  if (!updated) {
    nextLines.push(normalizedKey + '=' + normalizedValue);
  }

  fs.writeFileSync(ENV_PATH, nextLines.join('\n') + '\n', 'utf8');
  return true;
};

module.exports = { parseBoolean, loadEnv, writeEnvValue };
