# Stock Strategy Lab

A responsive, explainable stock-strategy scanner published with GitHub Pages.

## Features

- Live daily market data when the public data endpoint is reachable
- Clearly labeled deterministic demo fallback when live retrieval fails
- Trend confirmation, Bollinger/RSI mean reversion, and ATR/volume breakout strategies
- Trend, range-bound, and volatile regime detection with strategy weighting
- Interactive price and compounded equity charts
- Backtests that calculate signals at the close and execute at the next session's open
- Plain-English decision reasons and downloadable CSV decision logs
- Five-part Quant Ensemble covering trend, SPY-relative strength, mean reversion, breakout quality, and risk
- Market-context regimes with transparent strategy weights and evidence-quality scoring
- Cost-aware next-session backtests with CAGR, Sharpe, Sortino, drawdown, exposure, profit factor, and SPY comparison
- Permanent Research Library with plain-English paper summaries, direct sources, implementation notes, limitations, and a dated research log
- Saved light/dark theme with system preference support
- Accessible desktop navigation, mobile tab bar, and complete Jump to menu
- Installable PWA shell with offline demo support and update-safe caching
- Keyboard focus, live status messages, reduced-motion support, and 44px touch targets

## Important note

This project is for education only and is not personalized financial advice. Live quotes may be delayed. Demo data is simulated and must not be used for trading decisions.

## Files

- `index.html` — semantic application structure
- `style.css` — original visual foundation
- `polish.css` — semantic theme, accessibility, responsive, and app-like design layer
- `script.js` — indicators, market data, charts, backtests, and CSV logs
- `enhancements.js` — preferences, navigation state, dialogs, install, and offline feedback
- `manifest.webmanifest` and `sw.js` — installable app and offline shell
