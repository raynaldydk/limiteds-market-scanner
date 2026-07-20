# Limiteds Market Scanner

A dependency-free local report that scans every active Roblox Limited listing from Limiteds Market's public listings endpoint.

The application collects all result pages on the server, resolves each exact official Roblox asset, retrieves its current RAP from Roblox, calculates price-to-RAP metrics, and presents the listings in a searchable report table. It does not require an account, cookies, browser automation, or third-party packages.

## Requirements

- Node.js 20 or newer
- Internet access to `limitedsmarket.com`

## Run

```powershell
npm.cmd start
```

Open <http://127.0.0.1:8000>.

On shells where the `npm` script shim is enabled, `npm start` works as well. The server binds only to `127.0.0.1` by default.

## Features

- Fetches every paginated listing, not only the first page
- Shows Listed RAP and current Roblox RAP as separate columns
- Converts USD prices with Limiteds Market's current IDR rate
- Shows after-tax IDR as `price_idr × 105.3%`
- Calculates average daily sales from Roblox's trailing 30-day volume history
- Search and filter by category, maximum price, and minimum RAP
- Sort by value, price, RAP, or listing age
- Retrieves current RAP from Roblox's migrated Marketplace Sales endpoint
- Resolves exact names only when the creator is the official `Roblox` account
- Prioritizes RAP lookups by each item's lowest-priced USD listing
- Computes USD per 1,000 current RAP and RAP per USD
- CSV export of the current filtered view
- Direct links to the original listings
- Direct Rolimon's item-page links after exact Roblox asset resolution
- No credentials, cookies, browser automation, or third-party Python packages

## Report columns

| Column | Meaning |
| --- | --- |
| Price IDR | USD price converted with Limiteds Market's IDR rate |
| After tax IDR | `USD price × IDR rate × 1.053` |
| Listed RAP | Value/RAP supplied with the Limiteds Market listing |
| Roblox RAP | Current `recentAveragePrice` supplied by Roblox Marketplace Sales |
| Daily Sales (30d) | Roblox sales during the trailing 30 UTC days divided by 30 |
| IDR / 1K RAP | `after_tax_idr × 1,000 ÷ RAP`; lower values represent more RAP per rupiah after tax |
| Listed | Listing creation timestamp formatted as `dd/mm/yyyy:hh.mm.ss` |

## Configuration

| Environment variable | Default | Description |
| --- | ---: | --- |
| `PORT` | `8000` | Local HTTP port |
| `CACHE_TTL_SECONDS` | `30` | Time before the server fetches a fresh market snapshot |
| `RAP_TTL_SECONDS` | `300` | Time before a confirmed Roblox RAP is refreshed |
| `CURRENCY_TTL_SECONDS` | `3600` | Time before the Limiteds Market IDR rate is refreshed |

Example:

```powershell
$env:PORT = 8080
$env:CACHE_TTL_SECONDS = 60
npm.cmd start
```

## Local API

`GET /api/scan` returns the normalized market report as JSON. Add `?refresh=1` to bypass the market cache and queue a fresh Roblox RAP lookup using known IDs where available.

```text
GET http://127.0.0.1:8000/api/scan?refresh=1
```

The response contains `items`, `total`, `cached`, `scanned_at`, and `duration_ms`. See [Architecture and data reference](docs/ARCHITECTURE.md) for details.

## Test

```powershell
npm.cmd test
```

The test suite uses Node's built-in test runner and makes no network requests.

## Project structure

```text
server.mjs              HTTP server, upstream scanner, cache, derived metrics
static/index.html       Report markup
static/app.js           Filters, sorting, rendering, and CSV export
static/styles.css       Responsive report styling
static/rap.css          Current-RAP status styling
test/server.test.mjs    Scanner pagination and cache tests
docs/ARCHITECTURE.md    Architecture, API schema, and operational notes
```

## Data source and disclaimer

This is an independent viewer and is not affiliated with LimitedsMarket or Roblox. Be considerate with scan frequency and review the source site's terms before deploying an automated polling service.
