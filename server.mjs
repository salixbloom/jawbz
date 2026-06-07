import { createServer, request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the Kalthraxius aggregator-query node (the actual job-search API) is
// listening. Override with KALTHRAXIUS_URL=http://host:port if it runs elsewhere.
const BACKEND = new URL(process.env.KALTHRAXIUS_URL ?? 'http://127.0.0.1:3000')
// Defaults to 8000, not 3000 — the aggregator-query node's own default port,
// to avoid a collision when running both locally.
const PORT = Number(process.env.PORT ?? 8000)
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

/**
 * The aggregator-query node already sends permissive CORS headers, so the
 * browser could call it directly — but proxying keeps the frontend pointed at
 * a single same-origin URL regardless of where the backend lives, so the only
 * thing you configure is KALTHRAXIUS_URL on the server side.
 */
const server = createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(err?.message ?? err) }))
  })
})

const PROXIED_ROUTES = [
  { pathname: '/stats', methods: ['GET'] },
  { pathname: '/jobs', methods: ['GET'] },
  { pathname: '/search', methods: ['POST'] },
]

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (PROXIED_ROUTES.some(r => r.pathname === url.pathname && r.methods.includes(req.method ?? ''))) {
    return proxyToBackend(req, res, `${url.pathname}${url.search}`)
  }
  if (/^\/jobs\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
    return proxyToBackend(req, res, url.pathname)
  }
  return serveStatic(url.pathname, res)
}

/** Forward the request to the QueryServer and pipe its response straight back. */
function proxyToBackend(req, res, path) {
  return new Promise(resolve => {
    const target = new URL(path, BACKEND)
    const upstream = httpRequest(
      target,
      { method: req.method, headers: { ...req.headers, host: target.host } },
      upstreamRes => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
        upstreamRes.on('end', resolve)
      },
    )
    upstream.on('error', err => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Could not reach the Kalthraxius aggregator-query node', detail: err.message, backend: BACKEND.origin }))
      resolve()
    })
    req.pipe(upstream)
  })
}

async function serveStatic(pathname, res) {
  const relative = pathname === '/' ? '/index.html' : pathname
  const filePath = normalize(join(PUBLIC_DIR, relative))
  if (!filePath.startsWith(PUBLIC_DIR + sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'content-type': 'text/plain' })
    return res.end('forbidden')
  }
  try {
    const data = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`jawbz frontend:  http://127.0.0.1:${PORT}`)
  console.log(`proxying to aggregator-query node at ${BACKEND.origin}`)
})
