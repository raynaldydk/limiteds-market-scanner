# Architecture and data reference

## Overview

The scanner is a small Node.js application built entirely with platform APIs. A single HTTP process serves the static report and proxies market data so the browser does not need to call the source site directly.

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

## Scan lifecycle

1. The browser requests `GET /api/scan`.
2. The server returns its in-memory snapshot when it is less than `CACHE_TTL_SECONDS` old.
3. Otherwise, the server requests pages of 40 listings from Limiteds Market.
4. Pagination continues until the reported `totalPages` value is reached.
5. Each item name is trimmed and queued for exact Roblox asset resolution.
6. The report is returned immediately with unresolved RAP rows marked `updating`.
7. A throttled background worker processes unique item names in ascending order of their cheapest USD listing, accepts only exact-name results created by the official Roblox account, resolves its migrated `CollectibleItemId`, then requests `recentAveragePrice` from Roblox Marketplace Sales.
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
| `idr_per_1k_rap` | number or `null` | IDR listing price per 1,000 current Roblox RAP |
| `market_rap` | number | Original marketplace RAP retained for diagnostics only |
| `rap` | number or `null` | Current Roblox `recentAveragePrice`; never falls back to `market_rap` |
| `rap_status` | string | `queued`, `updating`, `current`, `unmatched`, `unavailable`, or `retrying` |
| `rap_checked_at` | string or `null` | ISO timestamp of the Roblox lookup |
| `roblox_asset_id` | number or `null` | Exact official Roblox catalog asset ID |
| `roblox_collectible_item_id` | string or `null` | Migrated collectible identifier used by Marketplace Sales |

Metrics are `null` when their divisor is zero. They are presentation aids, not financial advice or estimates of future sale value.

## Client behavior

The browser keeps the latest response in memory and applies all search, category, price, RAP, and sort controls locally. CSV export includes only the currently filtered rows and uses these columns:

```text
item_name, category, idr_rate, price_idr, after_tax_idr,
market_rap, rap, rap_status, rap_checked_at, roblox_asset_id,
roblox_collectible_item_id, idr_per_1k_rap, created_at, listing_url
```

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
