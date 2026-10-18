const HELP_LINES = [
  '  <MINT>              Set the current mint address',
  '  live                Toggle live mode on/off',
  '  buy [SOL]           Buy the current mint using SOL amount',
  '  buyamt [SOL]        Set the strategy buy amount (used by DCA / auto buys)',
  '  sell [PERCENT]      Sell 100% of the current mint position',
  '  wallet              Show the current SOL balance for the configured wallet',
  '  mcap                Show the current mint market cap from PumpPortal/Pump.fun',
  '  pos                 Show current position, bot state, and account snapshot',
  '  strategy [NAME]     Set the active strategy',
  '  dbg                 Toggle verbose trade-signal logging',
  '  start               Start the active strategy',
  '  stop                Stop the active strategy',
  '  help                Show this help section',
  '  exit                Quit Caterkiller',
];

const printHelp = () => {
  console.log('\nCommands:');
  HELP_LINES.forEach((line) => console.log(line));
};

const banner = () => {
  console.log('========================================');
  console.log('Caterkiller  v0.1');
  console.log('Minimal Pump.fun trading bot');
  console.log('========================================');
};

module.exports = { printHelp, banner };
