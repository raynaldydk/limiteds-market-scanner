# Architecture and data reference

## Overview

The scanner is a small Node.js application built entirely with platform APIs. A single HTTP process serves the Scan & Analysis and Calculator pages and proxies market data so the report browser does not need to call the source site directly.

```text
Browser report
    │ GET /api/scan
    ▼
Node HTTP server
    ├── paginated GET /api/listings → Limiteds Market
    ├── exact-name catalog search  → Roblox Catalog
    ├── collectible ID by asset ID → Roblox Economy
    └── resale data by collectible → Roblox Marketplace Sales
```

No listing data is stored on disk. The server keeps one snapshot in memory for the configured cache period.

Seller UUIDs are assigned stable sequential labels such as `Seller 1` and `Seller 2`. The private UUID-to-number mapping persists in the Git-ignored `data/seller-map.json` file. The original UUID remains available in API and CSV data as `seller_id`; the label number is returned as `seller_internal_id`.

Static pages:

- `/` - Scan & Analysis report backed by `GET /api/scan`
- `/calculator.html` - client-side purchase profitability calculator
- `/accounts.html` - browser-local Roblox account manager
- `/sell-robux.html` - persistent Robux sale entry and history

All pages load `theme.js`. The top-right Light/Dark toggle stores the selected theme in browser `localStorage` under `limiteds-market-theme`, so the preference persists across pages and reloads. Theme colors are applied with shared CSS custom properties and `data-theme` on the root document element.

The Account Manager persists records as formatted JSON in `data/accounts.json` through `GET` and `PUT /api/accounts`. Browser `localStorage` under `limiteds-market-accounts` remains a migration and recovery backup; when the text file is empty, existing browser records are copied into it automatically. The data file is excluded from Git to avoid publishing personal account records. `GET /api/roblox/account?username=...` resolves an exact public Roblox username, retrieves its avatar headshot, and reads up to 1,000 public collectible inventory records. `limitedRapTotal` is the sum of `recentAveragePrice` across the returned collectibles. No authentication tokens or Roblox credentials are collected.

The client calculates the combined Estimated Robux card as the sum of `ROUND(0.7 x limitedRapTotal) + robux + robuxPending` for every saved account.

Executive purchase spending normally uses `purchasePrice`. A completed purchase may preserve its original price while providing `businessCostIdr` and `personalCostAllocationIdr`; reporting then uses `businessCostIdr` so owner consumption does not reduce operating performance or Net Cash Flow.

The Executive Summary period filter operates in the browser's local calendar timezone. All Time, Date, Month, and Year modes filter Buying and Sell Robux transactions before calculating spending, revenue, cash flow, purchase mix, and recent activity. Historical modes also select snapshots from `data/account-snapshots.json`, use the latest matching snapshot as the closing account state, and calculate opening, average, and portfolio change at the currently selected valuation rate. All Time uses live Account Manager state.

`POST /api/account-snapshots` reads current accounts and captures their RAP, balance, pending, Plus status, estimated Robux, account asset value, and portfolio IDR. Automatic snapshots use Jakarta date keys and replace the prior automatic record for that day; manual snapshots are always retained. `GET /api/account-snapshots` returns the history. Account Manager calls automatic capture after a successful inventory refresh and exposes **Save Snapshot** for manual capture. The snapshot file is excluded from Git because it contains private account history.

Each account row shows `limitedToRobux = ROUND(0.7 x limitedRapTotal)`. Quota is rendered as `quotaRobux / remainingSendLimit`, where `quotaRobux = robux + robuxPending` and `remainingSendLimit = MAX(0, sendLimit - sendLimitUsed)`.

The selected Account Manager Robux Sell Rate (130, 135, or 140) is stored under `limiteds-market-account-sell-rate`. The Estimated IDR card is `Estimated Robux x selected rate` and re-renders immediately when the selector changes.

Roblox balance, pending transaction, and transaction-total endpoints require Roblox session-cookie authentication rather than public APIs, so this application does not automate those fields or request `.ROBLOSECURITY` cookies.

## Robux sales

`GET /api/robux-sales` reads sale history and `POST /api/robux-sales` inserts a sale. The server validates rate, available account Robux, and remaining send limit. A successful insertion applies:

```text
price = robuxSold x rate
account.robux = account.robux - robuxSold
account.sendLimitUsed = account.sendLimitUsed + robuxSold
```

Updated accounts persist in `data/accounts.json`; sale history persists in the Git-ignored `data/robux-sales.json`.

## Scan lifecycle

1. The browser requests `GET /api/scan`.
2. The server returns its in-memory snapshot when it is less than `CACHE_TTL_SECONDS` old.
3. Otherwise, the server requests pages of 40 listings from Limiteds Market.
4. Pagination continues until the reported `totalPages` value is reached.
5. Each item name is trimmed and queued for exact Roblox asset resolution.
6. The report is returned immediately with unresolved RAP rows marked `updating`.
7. A throttled background worker processes unique item names in ascending order of their cheapest USD listing, accepts only exact-name results created by the official Roblox account, resolves its migrated `CollectibleItemId`, then requests `recentAveragePrice` from Roblox Marketplace Sales. Listings categorized as `Face` use creator-filtered catalog search v2 because v1 can omit exact migrated results, open the official replacement Dynamic Head bundle, and read the collectible ID from the bundle because migrated legacy face assets no longer expose one.
8. The browser polls the local report while work remains and fills current RAP progressively.
9. Browser-side filters and sorting operate on each updated snapshot.

The report's **Refresh report** action requests `/api/scan?refresh=1`, which bypasses the market snapshot cache and expires confirmed Roblox RAP values. Previously resolved asset and collectible IDs are reused, so refreshes need only the Marketplace Sales request.

## Local endpoint

### `GET /api/scan`

Query parameters:

| Parameter | Value | Effect |
| --- | --- | --- |
| `refresh` | `1` | Ignore the current in-memory snapshot and scan every upstream page |

Successful response:

```json
{
  "items": [],
  "total": 107,
  "cached": false,
  "scanned_at": "2026-07-20T08:00:00.000Z",
  "duration_ms": 812
}
```

An upstream HTTP, connection, or timeout failure returns HTTP `502`:

```json
{
  "error": "Market scan failed: upstream returned HTTP 503"
}
```

## Normalized item fields

The scanner preserves the listing fields received from Limiteds Market and adds:

| Field | Type | Description |
| --- | --- | --- |
| `listing_url` | string | Original Limiteds Market listing URL |
| `idr_rate` | number | IDR units per USD from Limiteds Market's currency endpoint |
| `price_idr` | number | Rounded listing price converted to IDR |
| `after_tax_idr` | number | Rounded IDR price after multiplying by `1.053` |
| `idr_per_1k_rap` | number or `null` | After-tax IDR price per 1,000 current Roblox RAP |
| `sales_30d` | number or `null` | Total Roblox resale volume in the trailing 30 UTC calendar days |
| `avg_daily_sales_30d` | number or `null` | `sales_30d ÷ 30`, rounded to two decimals |
| `robux_sell` | number or `null` | `ROUND(0.7 × current Roblox RAP)` |
| `market_rap` | number | Original marketplace RAP retained for diagnostics only |
| `rap` | number or `null` | Current Roblox `recentAveragePrice`; never falls back to `market_rap` |
| `rap_status` | string | `queued`, `updating`, `current`, `unmatched`, `unavailable`, or `retrying` |
| `rap_checked_at` | string or `null` | ISO timestamp of the Roblox lookup |
| `roblox_asset_id` | number or `null` | Exact official Roblox catalog asset ID |
| `roblox_bundle_id` | number or `null` | Official migrated Dynamic Head bundle ID for Face listings |
| `roblox_collectible_item_id` | string or `null` | Migrated collectible identifier used by Marketplace Sales |
| `rolimons_url` | string or `null` | Rolimon's bundle URL for migrated Faces, otherwise an item URL built from the asset ID |
| `roblox_url` | string or `null` | Roblox bundle URL for migrated Faces, otherwise a catalog detail URL built from the asset ID |

Metrics are `null` when their divisor is zero. They are presentation aids, not financial advice or estimates of future sale value.

## Client behavior

The Scan & Analysis page keeps the latest response in memory and applies all search, category, price, RAP, minimum daily-sales, and sort controls locally. CSV export includes only the currently filtered rows and uses these columns:

The selected Robux Sell Rate (130, 135, or 140 IDR) is applied in the browser. `robux_sell_idr = robux_sell × rate`, `profit_idr = robux_sell_idr − after_tax_idr`, and `profit_cost_ratio = (profit_idr ÷ after_tax_idr) × 100`. Changing the selector re-renders all rows immediately.

```text
item_name, category, idr_rate, price_idr, after_tax_idr,
market_rap, rap, robux_sell, robux_sell_rate, robux_sell_idr,
profit_idr, profit_cost_ratio, rap_status, rap_checked_at, roblox_asset_id,
roblox_collectible_item_id, sales_30d, avg_daily_sales_30d,
idr_per_1k_rap, created_at, listing_url, roblox_url, rolimons_url
```

## Calculator behavior

The Calculator makes no API requests. It accepts a Rupiah price, Roblox RAP, and a Robux Sell Rate of 130, 135, or 140. The price input is displayed with Indonesian thousand separators. Its purchase-source toggle controls whether tax is applied:

```text
LimitedsMarket price = ROUND(listed price x 1.053)
Direct Seller price  = listed price
Robux Sell           = ROUND(Roblox RAP x 0.7)
Robux Sell IDR       = Robux Sell x selected rate
IDR / 1K RAP         = purchase price x 1,000 / Roblox RAP
Profit               = Robux Sell IDR - purchase price
Profit / Cost        = Profit / purchase price x 100
```

The calculator is constrained to one viewport on desktop. Its mobile layout stacks the form and results and restores normal vertical scrolling.

## Security and operational notes

- The server binds to loopback (`127.0.0.1`) and is intended for local use.
- Static paths are normalized before files are read from the `static` directory.
- Upstream requests have a 20-second timeout and identify the application with a user-agent.
- Roblox lookups run sequentially with delay and exponential retry to respect rate limits.
- Confirmed RAP values are refreshed after `RAP_TTL_SECONDS` (five minutes by default).
- API responses use `Cache-Control: no-store`; static files use `no-cache` during local development.
- There is no authentication because the server is not exposed beyond the local machine by default.
- The upstream endpoint is not controlled by this project and may change without notice.
- A production deployment should add request coalescing, rate limiting, structured logging, and an explicit upstream-use review.

## Testing

The tests inject a fake `fetch` implementation into the scanner. They verify that:

- every reported page is requested;
- normalized names and derived values are correct; and
- a fresh in-memory snapshot prevents duplicate upstream scans.

Run them with `npm.cmd test` on Windows PowerShell or `npm test` elsewhere.
