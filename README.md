# Limiteds Market Scanner

A dependency-free local application for scanning Roblox Limited listings, analyzing current Roblox RAP, and calculating purchase profitability.

## Requirements

- Node.js 20 or newer
- Internet access to `limitedsmarket.com` and Roblox endpoints

## Run

```powershell
npm.cmd start
```

Open:

- Scan & Analysis: <http://127.0.0.1:8000>
- Calculator: <http://127.0.0.1:8000/calculator.html>
- Account Manager: <http://127.0.0.1:8000/accounts.html>
- Sell Robux: <http://127.0.0.1:8000/sell-robux.html>
- Limited Buying: <http://127.0.0.1:8000/limited-buying.html>

The server binds to `127.0.0.1` by default.

## Scan & Analysis

- Fetches every paginated LimitedsMarket listing
- Converts listing prices using LimitedsMarket's current IDR rate
- Displays Price IDR including the 5.3% tax
- Resolves exact catalog names created by the official Roblox account
- Resolves migrated Face items with Roblox catalog search v2, then reads the collectible ID from their official Dynamic Head bundle
- Retrieves current RAP and 30-day resale volume from Roblox
- Calculates average daily sales over the trailing 30 UTC days
- Prioritizes RAP updates using each item's lowest-priced listing
- Filters by name, category, maximum price, minimum RAP, and minimum daily sales
- Sorts by value, price, RAP, or listing age
- Selectable Robux Sell Rates of 130, 135, and 140 IDR
- Live Robux sale, profit, and profit-to-cost analysis
- CSV export of the filtered report
- Links migrated Faces to their Roblox and Rolimon's bundle pages; ordinary limiteds use item pages
- Persistent Light/Dark mode toggle shared by Scan & Analysis and Calculator

## Report formulas

| Column | Formula or meaning |
| --- | --- |
| Seller | Persistent local label (`Seller 1`, `Seller 2`, and so on) mapped from LimitedsMarket's seller UUID |
| Daily Sales (30d) | Roblox sales in the trailing 30 UTC days divided by 30 |
| Roblox RAP | Current Roblox `recentAveragePrice` |
| Robux Sell | `ROUND(0.7 x Roblox RAP)` |
| Price IDR | `USD price x IDR rate x 1.053` |
| IDR / 1K RAP | `Price IDR x 1,000 / Roblox RAP` |
| Robux Sell IDR | `Robux Sell x selected rate` |
| Profit | `Robux Sell IDR - Price IDR` |
| Profit / Cost | `(Profit / Price IDR) x 100`, shown with two decimals |
| Listed | Date and time on separate lines: `dd/mm/yyyy` and `hh.mm.ss` |

IDR / 1K RAP is highlighted red when the row's calculated profit is below zero at the selected Robux Sell Rate.

## Calculator

The Calculator works independently of the live scan. Enter a Rupiah price and Roblox RAP, select a Robux Sell Rate, and toggle the purchase source:

- **LimitedsMarket:** adds 5.3% tax to the listed price
- **Direct Seller:** uses the listed price without tax
- Price input is formatted as Indonesian Rupiah, for example `Rp 1.000.000`
- All results update immediately
- The desktop layout fits within one viewport; mobile uses a stacked scrollable layout

Calculator formulas:

```text
Price IDR (LimitedsMarket) = ROUND(listed price x 1.053)
Price IDR (Direct Seller)  = listed price
Robux Sell                 = ROUND(Roblox RAP x 0.7)
Robux Sell IDR             = Robux Sell x selected rate
IDR / 1K RAP               = Price IDR x 1,000 / Roblox RAP
Profit                     = Robux Sell IDR - Price IDR
Profit / Cost              = Profit / Price IDR x 100
```

## Account Manager

The Account Manager adds accounts by exact Roblox username. It automatically retrieves the public user ID, display name, profile link, avatar, public collectible inventory, and total collectible RAP. The saved record also includes editable Robux, Robux Pending, Robux Send Limit, Robux Send Limit Used, and Robux Plus Status fields. Records are written to `data/accounts.json`, with browser storage retained as a migration and recovery backup. It requires no Roblox password, OAuth app, or `.ROBLOSECURITY` cookie. Private inventories cannot be retrieved.

Each saved account includes icon links to its Roblox profile and Rolimon's player page.

The Estimated Robux summary is `ROUND(0.7 x Limiteds RAP) + Robux + Robux Pending`, summed across saved accounts.

The Account Manager includes a persistent Robux Sell Rate selector with 130, 135, and 140 IDR options. Estimated IDR is `Estimated Robux x selected Robux Sell Rate`.

The Send Limit summary displays combined `Robux Send Limit Used / Robux Send Limit` across saved accounts.

Each account row includes `Limited to Robux = ROUND(Limiteds RAP x 0.7)` and Quota displayed as `(Limited to Robux + Robux + Robux Pending) / (Robux Send Limit - Send Limit Used)`.

## Sell Robux

The Sell Robux page records a source username, Robux sold, a rate of 130/135/140, calculated IDR price, and timestamp. Inserting a record subtracts `Robux Sold` from the selected account's Robux balance and adds it to Robux Send Limit Used. A sale is rejected when the account lacks Robux or remaining send limit. Records persist in the Git-ignored `data/robux-sales.json` file. The username filter and 1/7/30-day period toggle update both the KPI cards and sales history while retaining the desktop one-viewport layout.

## Limited Buying

The Limited Buying page assigns each purchase to a username selected from Account Manager and records item name, RAP, after-tax purchase price, purchase date, and a Robux sell rate. `Scan RAP` looks up current Roblox RAP from the exact item name and supports the face/dynamic-head fallback. KPI cards include Total RAP and Estimated Robux, calculated as the sum of each item's rounded 70% RAP. The page calculates `70% RAP = ROUND(0.7 x RAP)`, `Est. Revenue = 70% RAP x Rate`, `Minimum Robux Sell = CEILING(Purchase Price / Rate)`, and `Profit Est. = Est. Revenue - Purchase Price`. Purchases persist locally in the Git-ignored `data/limited-purchases.json` file.

## Configuration

| Environment variable | Default | Description |
| --- | ---: | --- |
| `PORT` | `8000` | Local HTTP port |
| `CACHE_TTL_SECONDS` | `30` | Market snapshot lifetime |
| `RAP_TTL_SECONDS` | `300` | Confirmed Roblox RAP lifetime |
| `CURRENCY_TTL_SECONDS` | `3600` | LimitedsMarket IDR rate lifetime |

## Local API

`GET /api/scan` returns the normalized market report. Add `?refresh=1` to bypass the market cache and queue fresh Roblox RAP lookups.

```text
GET http://127.0.0.1:8000/api/scan?refresh=1
```

## Test

```powershell
npm.cmd test
```

The test suite uses Node's built-in test runner and makes no network requests.

## Project structure

```text
server.mjs              HTTP server, scanner, cache, and derived metrics
static/index.html       Scan & Analysis page
static/app.js           Report filters, sorting, rendering, and CSV export
static/styles.css       Shared responsive styling
static/rap.css          Report and navigation styling
static/calculator.html  Standalone Calculator page
static/calculator.js    Calculator formatting and formulas
static/calculator.css   Viewport-fitted Calculator layout
static/accounts.html    Local Account Manager page
static/accounts.js      Browser-local account record management
static/accounts.css     Account table and editor styling
static/sell-robux.html  Robux sale entry and history page
static/sell-robux.js    Sale calculations and account updates
static/sell-robux.css   Sale form and history styling
static/limited-buying.html  Limited purchase entry and history page
static/limited-buying.js    Purchase calculations and persistence UI
static/limited-buying.css   Limited purchase report styling
test/server.test.mjs    Scanner, RAP, sales, and calculation tests
docs/ARCHITECTURE.md    Architecture, API schema, and operational notes
```

## Disclaimer

This independent viewer is not affiliated with LimitedsMarket, Roblox, or Rolimon's. Review upstream terms before deploying an automated polling service.
