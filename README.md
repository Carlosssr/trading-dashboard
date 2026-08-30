# trading-dashboard

This repository holds two independent projects.

## `command-center/` — Financial Command Center

A Next.js application that consolidates personal and business finances into one
dashboard while keeping the two sets of books structurally separate. Connects
financial institutions through a swappable aggregation provider, syncs balances
and transactions, and covers net worth, cash, debt and credit cards, bill pay,
business P&L, real estate, investments, and insights.

See [`command-center/README.md`](command-center/README.md) to run it, and
[`command-center/docs/`](command-center/docs/) for the architecture, data model,
API, and security model.

## Root — TraderVue

The original static trading journal (`index.html`, `css/`, `js/`, `data/`). It
predates the command centre, shares no code with it, and is untouched by it.
Open `index.html` directly in a browser to use it.
