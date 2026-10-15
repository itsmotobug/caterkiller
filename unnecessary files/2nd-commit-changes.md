# Day 2 Changes

## CLI & terminal UX
- Added ANSI color helpers for info, success, warning, and error output.
- Removed the noisy ticker command and cached-price ticker output.
- Simplified the prompt prefix and status banner to a cleaner system-style view.
- Improved the switching flow so live mode requires an explicit confirmation before toggling.
- Updated the prompt when the bot starts or stops so the current state is visible immediately.

## Bot mode & state model
- Replaced the older `trade` / `simulation` flags with a clearer `mode` model using `sim` and `live`.
- Renamed the runtime state to `botRunning` so the app state reads clearly and matches the wording in the terminal.
- Kept the bot state and strategy state separate so the bot can be running without the strategy being described as if it were a live actor.

## Command surface cleanup
- Removed the public `price` command and all price override logic.
- Simplified the help output to focus on the essential commands.
- Split the command semantics so `status` is the system snapshot and `position` is the holdings / cost basis / PnL snapshot.
- Kept `dump` as a compatibility alias, but treated `position` as the clearer public command.

## Position & reporting
- Added a dedicated position snapshot for current holdings, average cost, unrealized PnL, and profitability.
- Improved price formatting by using higher-precision SOL values and trimming trailing zeros.
- Updated the token display logic to prefer the Pump.fun `coins-v2/{mint}` response `symbol` and fall back to `n/a` instead of slicing the mint address.
- Tightened feed labels to `feed connected` and `feed idle` for clearer status context.

## Result
- The CLI now reads more like a minimal trading dashboard than a noisy debug shell.
- The command surface is easier to understand and far less misleading for real-world use.