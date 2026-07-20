# Architecture and data reference

## Overview

The scanner is a small Node.js application built entirely with platform APIs. A single HTTP process serves the static report and proxies market data so the browser does not need to call the source site directly.

```text
Browser report
    │ GET /api/scan
    ▼
Node HTTP server
    │ paginated GET /api/listings
    ▼
Limiteds Market public endpoint
```

No listing data is stored on disk. The server keeps one snapshot in memory for the configured cache period.

## Scan lifecycle

1. The browser requests `GET /api/scan`.
2. The server returns its in-memory snapshot when it is less than `CACHE_TTL_SECONDS` old.
3. Otherwise, the server requests pages of 40 listings from Limiteds Market.
4. Pagination continues until the reported `totalPages` value is reached.
5. Each item name is trimmed and report metrics and the original listing URL are added.
6. The normalized collection is cached and returned to the browser.
7. Browser-side filters and sorting operate on this complete snapshot without further network calls.

The report's **Refresh report** action requests `/api/scan?refresh=1`, which deliberately bypasses the snapshot cache.

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
| `usd_per_1k_rap` | number or `null` | Listing USD price per 1,000 RAP |
| `rap_per_usd` | number or `null` | RAP represented by one USD of listing price |
| `listing_url` | string | Original Limiteds Market listing URL |

Metrics are `null` when their divisor is zero. They are presentation aids, not financial advice or estimates of future sale value.

## Client behavior

The browser keeps the latest response in memory and applies all search, category, price, RAP, and sort controls locally. CSV export includes only the currently filtered rows and uses these columns:

```text
item_name, category, price_usd, rap, usd_per_1k_rap,
rap_per_usd, is_verified_seller, created_at, listing_url
```

## Security and operational notes

- The server binds to loopback (`127.0.0.1`) and is intended for local use.
- Static paths are normalized before files are read from the `static` directory.
- Upstream requests have a 20-second timeout and identify the application with a user-agent.
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
