# jawbz 🦈

A small local web frontend for searching jobs through a [Kalthraxius](https://github.com/salixbloom/Kalthraxius-the-GitHub-Repository)
`aggregator-query` node — the HTTP API that exposes a node's local SQLite job
store and full-text search index (see the project's
[API docs](https://github.com/salixbloom/Kalthraxius-the-GitHub-Repository/blob/main/wiki/API.md)).

## Running it

You need a Kalthraxius `aggregator-query` node running somewhere reachable,
e.g. on `http://127.0.0.1:3000` (its default — `KAL_QUERY_PORT`).

```bash
npm start
```

This starts a small static-file + proxy server on `http://127.0.0.1:8000`.
Open that URL in a browser.

If your `aggregator-query` node listens somewhere other than
`127.0.0.1:3000`, point at it with an environment variable:

```bash
KALTHRAXIUS_URL=http://127.0.0.1:3000 PORT=8000 npm start
```

## Why a proxy?

`server.mjs` is a tiny zero-dependency Node server that serves the static
frontend in `public/` and forwards `GET /stats`, `GET /jobs`, `GET /jobs/:hash`
and `POST /search` to the real `aggregator-query` node, so the frontend always
talks to a single same-origin URL regardless of where the backend node lives.
(The node itself already sends permissive CORS headers, so a proxy isn't
strictly required — but it keeps `KALTHRAXIUS_URL` as the only thing you need
to configure.)

## Frontend

Plain HTML/CSS/JS, no build step, no framework (`public/index.html`,
`style.css`, `app.js`):

- Search form mirroring the `SearchQuery` shape (`text`, `platformId`, `limit`)
  — a single request to `POST /search` returns scored `SearchHit` results.
- Results rendered as cards with relevance score, salary, seniority/YOE, and
  skill chips (from each hit's `enrichment`).
- A keyword filter box that narrows the already-loaded results client-side.
- Bookmarks ("save for later"), persisted in `localStorage` — acts as the
  simplest possible local store for jobs you want to revisit.
