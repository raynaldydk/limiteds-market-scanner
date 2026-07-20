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

## Report formulas

| Column | Formula or meaning |
| --- | --- |
| Daily Sales (30d) | Roblox sales in the trailing 30 UTC days divided by 30 |
| Roblox RAP | Current Roblox `recentAveragePrice` |
| Robux Sell | `ROUND(0.7 x Roblox RAP)` |
| Price IDR | `USD price x IDR rate x 1.053` |
| IDR / 1K RAP | `Price IDR x 1,000 / Roblox RAP` |
| Robux Sell IDR | `Robux Sell x selected rate` |
| Profit | `Robux Sell IDR - Price IDR` |
| Profit / Cost | `(Profit / Price IDR) x 100`, shown with two decimals |
| Listed | Date and time on separate lines: `dd/mm/yyyy` and `hh.mm.ss` |

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
test/server.test.mjs    Scanner, RAP, sales, and calculation tests
docs/ARCHITECTURE.md    Architecture, API schema, and operational notes
```

## Disclaimer

This independent viewer is not affiliated with LimitedsMarket, Roblox, or Rolimon's. Review upstream terms before deploying an automated polling service.
