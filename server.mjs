import { createServer, request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the Kalthraxius QueryServer (the actual job-search API) is listening.
// Override with KALTHRAXIUS_URL=http://host:port if it runs elsewhere.
const BACKEND = new URL(process.env.KALTHRAXIUS_URL ?? 'http://127.0.0.1:8080')
const PORT = Number(process.env.PORT ?? 3000)
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

/**
 * The QueryServer doesn't send CORS headers, so the browser can't call it
 * cross-origin. Instead the page talks to this server, which proxies the two
 * query routes through untouched and serves the static frontend for everything
 * else — keeping the browser side a same-origin, framework-free static site.
 */
const server = createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(err?.message ?? err) }))
  })
})

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/query' && req.method === 'POST') {
    return proxyToBackend(req, res, '/query')
  }
  if (url.pathname === '/query/stream' && (req.method === 'GET' || req.method === 'POST')) {
    return proxyToBackend(req, res, `/query/stream${url.search}`)
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
      res.end(JSON.stringify({ error: 'Could not reach the Kalthraxius QueryServer', detail: err.message, backend: BACKEND.origin }))
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
  console.log(`proxying to QueryServer at ${BACKEND.origin}`)
})
