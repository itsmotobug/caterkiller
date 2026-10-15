# Caterkiller trade flow

Caterkiller is a lightweight Pump.fun-style trading bot that does not trade continuously on raw price checks alone. Instead, it works as a signal-driven bot: it waits for a live market signal from a stream or API event, evaluates that signal against the active strategy, and only then decides whether to buy or sell.

## Core idea

The bot maintains a small internal state:

- the selected mint
- the current cached price
- the last known price
- the active strategy
- whether the bot is running
- the current position and cost basis

It then uses a live data feed and/or a strategy evaluation loop to decide whether conditions are favorable enough to place a trade.

## Price caching vs. trading signal

The bot does not simply fetch a price and immediately trade on it. The important detail is that trade decisions are gated by a signal.

- A price is cached into `state.currentPrice` when market data arrives.
- A live feed listener watches the PumpPortal-based realtime data source.
- When an event comes in, the code extracts a usable price from the payload.
- That price update is then used to evaluate whether the strategy says it is time to act.
- Only if the signal is positive does the bot call the buy or sell logic.

In other words: the price is a condition, but the trade is not executed merely because a price exists. It executes because the active strategy generated a buy/sell signal after the latest live data update.

## How live trade signals work

The flow is roughly:

1. Connect to the realtime feed.
2. Receive a message from the API.
3. Extract a price from the payload.
4. Update `state.currentPrice` and `state.lastPrice`.
5. Call `maybeAutoTrade()`.
6. `maybeAutoTrade()` checks if the bot is running and a mint is configured.
7. It calls `evaluateSignal()`.
8. `evaluateSignal()` inspects strategy-specific conditions.
9. If the signal returns `buy` or `sell`, the bot calls the corresponding trade action.

This means the bot is intentionally signal-driven rather than “check every number and buy immediately.”

## Strategy behavior

The strategy logic is not the same as market price fetching.

- DCA will buy on the configured interval if the bot is running and the state says it is ready.
- Other strategies compare recent price movement or trend information and generate buy/sell actions when thresholds are met.
- Those thresholds are only checked after live market data or a valid price snapshot is available.

## Why this matters

This model keeps the bot conservative and deliberate.

- It avoids blind trading from stale or isolated price fetches.
- It centralizes trade decisions in `maybeAutoTrade()` and `evaluateSignal()`.
- It reduces the chance of acting on a single random price or noisy market sample.

The bot is designed around a live signal flow, not a direct “always buy on price fetch” loop.

## Important caveat

This is still an experimental CLI bot. The market signal is treated as the trigger for actions, but the project is intentionally lightweight and not a production-grade autonomous trading system.
