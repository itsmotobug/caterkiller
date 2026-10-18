const { state } = require('../state');
const { PLACEHOLDER_DEFAULTS } = require('../config');
const { writeEnvValue } = require('../env');
const { logWarning, logError } = require('../log');
const { printHelp } = require('../ui/help');
const { showStatus } = require('../ui/status');
const { getWalletBalance } = require('../api/solana');
const { getMarketCap, getTokenDisplayNameForMint } = require('../api/pumpfun');
const { cleanupRealtimeSocket, syncMintSubscription } = require('../api/stream');
const { buy, sell } = require('../trading/execution');
const { setMode } = require('../trading/mode');
const { setStrategy, startStrategy, stopStrategy, strategyNames } = require('../trading/strategy');
const { refreshCurrentTokenSymbol } = require('../trading/token');

const CLOSE = Symbol('close');

const isMintLike = (value) => /^[A-Za-z0-9]{32,44}$/.test(String(value || '').trim());

const is = (...words) => (lower) => words.includes(lower);
const startsWithAny = (...prefixes) => (lower) => prefixes.some((prefix) => lower.startsWith(prefix));

// Everything after the first word, e.g. "buy 0.5" -> "0.5".
const argAfterWord = (input) => input.slice(input.indexOf(' ') + 1).trim();

const toggleDebug = () => {
  state.debug = !state.debug;
  console.log('Verbose trade debug: ' + (state.debug ? 'on' : 'off'));
};

const listStrategies = () => console.log('Available strategies: ' + strategyNames());

const showBuyAmount = () => console.log('Current buy amount: ' + state.buyAmountSol + ' SOL');

const setBuyAmount = (raw) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logError('Buy amount must be a positive number in SOL.');
    return;
  }

  state.buyAmountSol = parsed;
  state.strategy = state.strategy || 'dca';
  writeEnvValue('DCA_AMOUNT_SOL', parsed);
  console.log('Buy amount set to: ' + parsed + ' SOL');
};

const changeMint = async (nextMint) => {
  if (state.mint && nextMint === state.mint) {
    logWarning('Mint is already set to: ' + state.mint + ' — no change made.');
    return;
  }

  if (state.mint && state.position.tokens > 0) {
    const coinSymbol = await getTokenDisplayNameForMint(state.mint);
    logWarning('Dumping existing holdings of ' + coinSymbol + '...');
    await sell(100);
  }

  state.mint = nextMint;
  state.currentTokenSymbol = '';
  await refreshCurrentTokenSymbol();
  writeEnvValue('MINT', nextMint);
  syncMintSubscription();
  console.log('Current mint set to: ' + state.mint);
};

const commands = [
  { match: is('help'), run: () => printHelp() },
  {
    match: is('exit', 'quit'),
    run: () => {
      console.log('Closing Caterkiller.');
      cleanupRealtimeSocket();
      return CLOSE;
    },
  },
  { match: is('status', 'position', 'pos'), run: () => showStatus() },
  { match: is('wallet'), run: () => getWalletBalance() },
  { match: is('mcap'), run: () => getMarketCap() },
  { match: is('dbg'), run: toggleDebug },
  { match: is('strategy', 'strat'), run: listStrategies },
  { match: startsWithAny('strategy ', 'strat '), run: (input) => setStrategy(argAfterWord(input)) },
  { match: is('start'), run: () => startStrategy() },
  { match: is('stop'), run: () => stopStrategy() },
  { match: is('live'), run: () => setMode(state.mode === 'live' ? 'sim' : 'live') },
  { match: is('live on'), run: () => setMode('live') },
  { match: is('live off'), run: () => setMode('sim') },
  { match: is('buy'), run: () => buy(String(PLACEHOLDER_DEFAULTS.BUY_SOL)) },
  { match: is('buyamt'), run: showBuyAmount },
  { match: startsWithAny('buyamt '), run: (input) => setBuyAmount(argAfterWord(input)) },
  {
    match: startsWithAny('buy '),
    run: (input) => buy(argAfterWord(input) || String(PLACEHOLDER_DEFAULTS.BUY_SOL)),
  },
  { match: is('sell'), run: () => sell(100) },
  { match: startsWithAny('sell '), run: (input) => sell(argAfterWord(input) || 100) },
  { match: (lower, input) => isMintLike(input), run: (input) => changeMint(input.trim()) },
  { match: startsWithAny('mint '), run: (input) => changeMint(argAfterWord(input)) },
];

const dispatch = async (input) => {
  const lower = input.toLowerCase();
  const command = commands.find((entry) => entry.match(lower, input));

  if (!command) {
    logWarning('Unknown command. Type `help` for commands.');
    return undefined;
  }

  return command.run(input);
};

module.exports = { dispatch, CLOSE };
