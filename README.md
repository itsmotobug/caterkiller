# Caterkiller

<p align="center">
  <img src="./caterkiller.png" alt="Cute Menacing Magenta Caterpillar Robot" width="240">
</p>

A tiny Pump.fun-style CLI trading bot for local experimentation.

This is a prototype: simulation-first, mostly untested in live markets, and meant to be used carefully.

It also tracks estimated PumpPortal API fee usage in [.api_fees](./.api_fees). On a hot coin, a busy websocket can cost roughly $0.10 for about 30 minutes.

See also

[Program jargon.txt](./jargon.txt)

## Quick start

```bash
npm install
node caterkiller.js
```

Windows:

```bat
start.bat
```

## Config

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

## Commands

```text
help
pos
wallet
mcap
strategy
strategy dca
start
stop
buyamt 0.01
buy 0.01
sell 100
exit
```

## Notes

- `STRATEGY` can be `dca`, `momentum`, `meanReversion`, or `breakout`
- `MODE` is `sim` or `live`
- Live trading is experimental and depends on the current PumpPortal feed
- This project is not a production trading system
