# jawbz
🦈

A small local web frontend for searching jobs through a [Kalthraxius](https://github.com/salixbloom/Kalthraxius-the-GitHub-Repository)
`QueryServer` — the HTTP gateway that fans a query out to the P2P aggregator
network and returns scored, enriched job postings.

## Running it

You need a Kalthraxius `QueryServer` (or aggregator node exposing one) running
somewhere reachable, e.g. on `http://127.0.0.1:8080` (its default).

```bash
npm start
```

This starts a small static-file + proxy server on `http://127.0.0.1:3000`.
Open that URL in a browser.

If your `QueryServer` listens somewhere other than `127.0.0.1:8080`, point at
it with an environment variable:

```bash
KALTHRAXIUS_URL=http://127.0.0.1:9090 PORT=3000 npm start
```

## Why a proxy?

The `QueryServer` doesn't send CORS headers, so a page can't call it directly
from a different origin. `server.mjs` is a tiny zero-dependency Node server
that serves the static frontend in `public/` and transparently forwards
`POST /query` and `GET /query/stream` (SSE) to the real `QueryServer`, so the
browser only ever talks same-origin.

## Frontend

Plain HTML/CSS/JS, no build step, no framework (`public/index.html`,
`style.css`, `app.js`):

- Search form mirroring the `QueryProfile` shape (`stack`, `yoeMax`,
  `salaryFloor`, `location`, `includeUnknown`, `limit`).
- Results stream in progressively over SSE (`/query/stream`), rendered as
  cards with score, qualification badge (confirmed vs. assumed), salary,
  seniority/YOE, posting age, and matched-skill chips.
- A keyword filter box that searches across already-loaded results — the API
  itself has no free-text search, so this fills that gap client-side without
  needing a server-side database.
- Bookmarks ("save for later"), persisted in `localStorage` — acts as the
  simplest possible local store for jobs you want to revisit.
