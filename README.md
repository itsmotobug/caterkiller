# Caterkiller

<p align="center">
  <img src="./caterkiller.png" alt="Cute Menacing Magenta Caterpillar Robot" width="240">
</p>

A tiny Pump.fun-style CLI trading bot for local experimentation.

Warning: this project has not been fully tested yet, and it may not work reliably as-is.

## What it does

- Starts a simple interactive Node.js CLI
- Lets you set a mint and configure a strategy
- Has a default DCA strategy that buys on a fixed interval
- Supports simulation mode by default
- Optionally connects to the PumpPortal realtime feed when an API key is present
- Lets you inspect status, balance, and market cap

## Run it

```bash
npm install
node caterkiller.js
```

Or on Windows:

```bat
start.bat
```

## Configure

Copy `.env.example` to `.env` and edit it:

```env
PUMP_API_KEY=
PUBLIC_WALLET_KEY=
MINT=11111111111111111111111111111111111111111111
STRATEGY=dca
MODE=sim
DCA_INTERVAL_MS=60000
DCA_AMOUNT_SOL=0.01
```

Notes:
- `STRATEGY` can be `dca`, `momentum`, `meanReversion`, or `breakout`
- `MODE` is `sim` or `live`
- `live` sends real PumpPortal trades; `sim` keeps everything local and safe
- `DCA_INTERVAL_MS` is in milliseconds
- `DCA_AMOUNT_SOL` is the SOL amount to buy each interval

## Commands

```text
help
status
balance
mcap
price 0.0001
strategy dca
start
stop
buy
buy 0.01
sell
sell 50
exit
```

## Important

This is a minimal local tool for experimentation, not a production trading system.
It is simulation-first and should be used carefully.

This project has not been fully tested yet, and it may not work correctly in its current form.
