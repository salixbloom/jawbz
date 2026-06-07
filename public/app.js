// Vanilla-JS frontend for the Kalthraxius aggregator-query node. No build
// step, no framework: this file is served as-is and talks to the same-origin
// proxy in server.mjs, which forwards /search, /jobs and /stats to the node.

const BOOKMARKS_KEY = 'jawbz:bookmarks:v1'

const form = document.getElementById('search-form')
const textInput = document.getElementById('text')
const platformIdInput = document.getElementById('platformId')
const limitInput = document.getElementById('limit')
const searchBtn = document.getElementById('search-btn')

const filterInput = document.getElementById('filter')
const statusEl = document.getElementById('status')
const resultsList = document.getElementById('results')
const bookmarksList = document.getElementById('bookmarks')
const emptyResults = document.getElementById('empty-results')
const emptyBookmarks = document.getElementById('empty-bookmarks')
const resultsCount = document.getElementById('results-count')
const bookmarksCount = document.getElementById('bookmarks-count')

const tabs = [...document.querySelectorAll('.tab')]
const panels = {
  results: document.getElementById('results-tab'),
  bookmarks: document.getElementById('bookmarks-tab'),
}

let results = []
let bookmarks = loadBookmarks()

init()

function init() {
  tabs.forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)))
  form.addEventListener('submit', onSubmit)
  filterInput.addEventListener('input', applyFilter)
  renderBookmarks()
}

// ---------------------------------------------------------------------------
// Search lifecycle (single request via POST /search)
// ---------------------------------------------------------------------------

function onSubmit(event) {
  event.preventDefault()
  const raw = textInput.value.trim()
  if (!raw) {
    setStatus('enter some search text — the API has no empty/browse-all query')
    return
  }
  const groups = parseBooleanQuery(raw)
  if (groups.length === 0) {
    setStatus('enter some search text — the API has no empty/browse-all query')
    return
  }
  runSearch(groups)
}

// The API's /search only takes a single opaque `text` string with no documented
// boolean syntax, so OR is implemented here by issuing one request per
// OR-branch and merging by contentHash; AND is enforced by re-checking that
// every AND-term actually appears in the result (the FTS index may rank rather
// than strictly require all terms).
async function runSearch(groups) {
  results = []
  resultsList.innerHTML = ''
  emptyResults.hidden = true
  filterInput.value = ''
  applyFilter()

  searchBtn.disabled = true
  setStatus('searching…')
  selectTab('results')

  const platformId = platformIdInput.value.trim()
  const limit = numberOrUndefined(limitInput.value)
  const seen = new Set()

  try {
    for (const terms of groups) {
      const query = { text: terms.join(' ') }
      if (platformId) query.platformId = platformId
      if (limit !== undefined) query.limit = limit

      const res = await fetch('/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `search failed (${res.status})`)
      }
      const hits = await res.json()
      for (const hit of hits) {
        if (!hit?.contentHash || !hit.indexed || seen.has(hit.contentHash)) continue
        if (!matchesAllTerms(buildSearchText(hit), terms)) continue
        seen.add(hit.contentHash)
        results.push(hit)
        resultsList.appendChild(renderJobCard(hit))
      }
    }
    applyFilter()
    setStatus(`done — ${results.length} result${results.length === 1 ? '' : 's'}`)
    if (results.length === 0) emptyResults.hidden = false
  } catch (err) {
    setStatus(`could not reach the aggregator-query node — is it running? (see README for setup) — ${err.message}`)
    if (results.length === 0) emptyResults.hidden = false
  } finally {
    searchBtn.disabled = false
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderJobCard(hit) {
  const job = hit.indexed?.job ?? {}
  const enrichment = hit.indexed?.enrichment ?? {}

  const li = document.createElement('li')
  li.className = 'job-card'
  li.dataset.hash = hit.contentHash
  li.dataset.searchText = buildSearchText(hit)

  const top = document.createElement('div')
  top.className = 'job-card-top'

  const titleBlock = document.createElement('div')
  const titleLink = document.createElement('a')
  titleLink.className = 'job-title'
  titleLink.href = job.url || '#'
  titleLink.target = '_blank'
  titleLink.rel = 'noopener noreferrer'
  titleLink.textContent = job.title || '(untitled posting)'
  titleBlock.appendChild(titleLink)

  const sub = document.createElement('div')
  sub.className = 'job-sub'
  sub.textContent = [job.company, job.location, job.platformId].filter(Boolean).join(' • ')
  titleBlock.appendChild(sub)
  top.appendChild(titleBlock)

  const bookmarkBtn = document.createElement('button')
  bookmarkBtn.type = 'button'
  bookmarkBtn.className = 'bookmark-btn'
  bookmarkBtn.title = 'Save for later'
  syncBookmarkButton(bookmarkBtn, hit.contentHash)
  bookmarkBtn.addEventListener('click', () => toggleBookmark(hit, bookmarkBtn))
  top.appendChild(bookmarkBtn)

  li.appendChild(top)

  const badges = document.createElement('div')
  badges.className = 'badges'
  badges.appendChild(scoreBadge(hit.score))
  const salary = formatSalary(hit)
  if (salary) badges.appendChild(textBadge(`💰 ${salary}`))
  if (enrichment.seniority?.value) badges.appendChild(textBadge(capitalize(enrichment.seniority.value)))
  if (enrichment.yoe?.value != null) badges.appendChild(textBadge(`${enrichment.yoe.value} yoe`))
  if (job.platformId) badges.appendChild(textBadge(job.platformId, 'muted'))
  li.appendChild(badges)

  if (job.description) {
    const desc = document.createElement('p')
    desc.className = 'job-desc'
    desc.textContent = stripHtml(job.description)
    li.appendChild(desc)
  }

  const skills = enrichment.skills ?? []
  if (skills.length) {
    const skillRow = document.createElement('div')
    skillRow.className = 'badges'
    for (const skill of skills) {
      const b = document.createElement('span')
      b.className = 'badge skill'
      b.textContent = skill.label
      skillRow.appendChild(b)
    }
    li.appendChild(skillRow)
  }

  return li
}

function scoreBadge(score) {
  return textBadge(`relevance ${Number(score).toFixed(1)}`)
}

function textBadge(text, extraClass = '') {
  const span = document.createElement('span')
  span.className = `badge ${extraClass}`.trim()
  span.textContent = text
  return span
}

// ---------------------------------------------------------------------------
// Bookmarks (persisted to localStorage — the "local DB" for saved jobs)
// ---------------------------------------------------------------------------

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return new Map(list.map(hit => [hit.contentHash, hit]))
  } catch {
    return new Map()
  }
}

function saveBookmarks() {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...bookmarks.values()]))
  } catch {
    // localStorage unavailable (private browsing, quota) — bookmarks just won't persist.
  }
}

function toggleBookmark(hit, button) {
  if (bookmarks.has(hit.contentHash)) bookmarks.delete(hit.contentHash)
  else bookmarks.set(hit.contentHash, hit)
  saveBookmarks()
  syncBookmarkButton(button, hit.contentHash)
  renderBookmarks()
}

function syncBookmarkButton(button, hash) {
  const active = bookmarks.has(hash)
  button.classList.toggle('active', active)
  button.textContent = active ? '★' : '☆'
}

function renderBookmarks() {
  bookmarksList.innerHTML = ''
  const items = [...bookmarks.values()]
  bookmarksCount.textContent = items.length ? `(${items.length})` : ''
  emptyBookmarks.hidden = items.length > 0
  for (const hit of items) bookmarksList.appendChild(renderJobCard(hit))
}

// ---------------------------------------------------------------------------
// Client-side keyword filter over the currently loaded results — narrows what
// a /search response already returned, without firing another request.
// ---------------------------------------------------------------------------

function applyFilter() {
  const raw = filterInput.value.trim()
  const groups = raw ? parseBooleanQuery(raw) : []
  const cards = resultsList.querySelectorAll('.job-card')
  let visible = 0
  cards.forEach(card => {
    const match = groups.length === 0 || matchesAnyGroup(card.dataset.searchText, groups)
    card.classList.toggle('hidden-by-filter', !match)
    if (match) visible++
  })
  resultsCount.textContent = results.length ? (raw ? `(${visible}/${results.length})` : `(${results.length})`) : ''
}

// ---------------------------------------------------------------------------
// Boolean query parsing — shared by the search box and the results filter.
//
// Comma or "OR"/"||" separate OR-branches; within a branch, whitespace or
// "AND"/"&&" separate terms that must all match. "agile docker, kubernetes"
// means (agile AND docker) OR kubernetes. Returns an array of term arrays
// (lowercased), e.g. [["agile","docker"],["kubernetes"]].
// ---------------------------------------------------------------------------

function parseBooleanQuery(raw) {
  return raw
    .split(/\s*(?:,|\bOR\b|\|\|)\s*/i)
    .map(branch =>
      branch
        .split(/\s*(?:\bAND\b|&&|\s+)\s*/i)
        .map(term => term.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter(terms => terms.length > 0)
}

function matchesAllTerms(searchText, terms) {
  return terms.every(term => searchText.includes(term))
}

function matchesAnyGroup(searchText, groups) {
  return groups.some(terms => matchesAllTerms(searchText, terms))
}

function buildSearchText(hit) {
  const job = hit.indexed?.job ?? {}
  const skills = (hit.indexed?.enrichment?.skills ?? []).map(s => s.label)
  return [job.title, job.company, job.location, job.platformId, stripHtml(job.description ?? ''), ...skills]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function selectTab(name) {
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name))
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function setStatus(text) {
  statusEl.textContent = text
}

function numberOrUndefined(value) {
  if (value === '' || value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function formatNumber(n) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
}

function formatSalary(hit) {
  const extraction = hit.indexed?.enrichment?.salary?.value
  if (extraction && (extraction.min != null || extraction.max != null)) {
    const currency = extraction.currency ? `${extraction.currency} ` : ''
    const period = extraction.period ? `/${extraction.period}` : ''
    let range
    if (extraction.min != null && extraction.max != null) range = `${formatNumber(extraction.min)}–${formatNumber(extraction.max)}`
    else if (extraction.min != null) range = `${formatNumber(extraction.min)}+`
    else range = `up to ${formatNumber(extraction.max)}`
    return `${currency}${range}${period}`
  }
  return hit.indexed?.job?.salary || null
}

function stripHtml(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

function capitalize(text) {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text
}
