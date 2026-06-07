// Vanilla-JS frontend for the Kalthraxius QueryServer. No build step, no
// framework: this file is served as-is and talks to the same-origin proxy in
// server.mjs, which forwards /query and /query/stream to the real QueryServer.

const BOOKMARKS_KEY = 'jawbz:bookmarks:v1'

const form = document.getElementById('search-form')
const stackInput = document.getElementById('stack')
const yoeMaxInput = document.getElementById('yoeMax')
const salaryFloorInput = document.getElementById('salaryFloor')
const locationInput = document.getElementById('location')
const limitInput = document.getElementById('limit')
const includeUnknownInput = document.getElementById('includeUnknown')
const searchBtn = document.getElementById('search-btn')
const stopBtn = document.getElementById('stop-btn')

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

let stream = null
let results = []
let seenHashes = new Set()
let bookmarks = loadBookmarks()

init()

function init() {
  tabs.forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)))
  form.addEventListener('submit', onSubmit)
  stopBtn.addEventListener('click', onStop)
  filterInput.addEventListener('input', applyFilter)
  renderBookmarks()
}

// ---------------------------------------------------------------------------
// Search lifecycle (SSE streaming via GET /query/stream?q=<base64 profile>)
// ---------------------------------------------------------------------------

function onSubmit(event) {
  event.preventDefault()
  const profile = buildProfile()
  if (profile.stack.length === 0 && !profile.location && profile.yoeMax === undefined && profile.salaryFloor === undefined) {
    // Still a valid query (an empty profile returns everything), but nudge the user.
    setStatus('searching with no filters — this returns everything the network has…')
  }
  startSearch(profile)
}

function onStop() {
  closeStream()
  setStatus(`stopped — ${results.length} result${results.length === 1 ? '' : 's'} so far`)
  if (results.length === 0) emptyResults.hidden = false
}

function buildProfile() {
  const stack = stackInput.value.split(',').map(s => s.trim()).filter(Boolean)
  const profile = { stack }
  const yoeMax = numberOrUndefined(yoeMaxInput.value)
  if (yoeMax !== undefined) profile.yoeMax = yoeMax
  const salaryFloor = numberOrUndefined(salaryFloorInput.value)
  if (salaryFloor !== undefined) profile.salaryFloor = salaryFloor
  const location = locationInput.value.trim()
  if (location) profile.location = location
  profile.includeUnknown = includeUnknownInput.checked
  const limit = numberOrUndefined(limitInput.value)
  if (limit !== undefined) profile.limit = limit
  return profile
}

function startSearch(profile) {
  closeStream()
  results = []
  seenHashes = new Set()
  resultsList.innerHTML = ''
  emptyResults.hidden = true
  filterInput.value = ''
  applyFilter()

  searchBtn.disabled = true
  stopBtn.hidden = false
  setStatus('connecting…')
  selectTab('results')

  const query = encodeURIComponent(toBase64Json(profile))
  stream = new EventSource(`/query/stream?q=${query}`)

  stream.addEventListener('open', () => setStatus('streaming results…'))

  stream.addEventListener('hit', event => {
    const hit = parseJson(event.data)
    if (!hit?.contentHash || seenHashes.has(hit.contentHash)) return
    seenHashes.add(hit.contentHash)
    results.push(hit)
    resultsList.appendChild(renderJobCard(hit))
    applyFilter()
    setStatus(`streaming results… ${results.length} so far`)
  })

  stream.addEventListener('done', event => {
    const summary = parseJson(event.data) ?? {}
    const answered = summary.answered?.length ?? 0
    const failed = summary.failed?.length ?? 0
    closeStream()
    setStatus(
      `done — ${answered} aggregator${answered === 1 ? '' : 's'} answered` +
        (failed ? `, ${failed} failed` : '') +
        `, ${results.length} unique result${results.length === 1 ? '' : 's'}`,
    )
    if (results.length === 0) emptyResults.hidden = false
  })

  stream.addEventListener('error', () => {
    const hadResults = results.length > 0
    closeStream()
    setStatus(
      hadResults
        ? `connection lost — ${results.length} result${results.length === 1 ? '' : 's'} so far`
        : 'could not reach the query server — is it running? (see README for setup)',
    )
    if (results.length === 0) emptyResults.hidden = false
  })
}

function closeStream() {
  if (stream) {
    stream.close()
    stream = null
  }
  searchBtn.disabled = false
  stopBtn.hidden = true
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderJobCard(hit) {
  const job = hit.job?.job ?? {}
  const enrichment = hit.job?.enrichment ?? {}

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
  badges.appendChild(qualificationBadge(hit.qualification))
  badges.appendChild(scoreBadge(hit.score))
  const salary = formatSalary(hit)
  if (salary) badges.appendChild(textBadge(`💰 ${salary}`))
  if (enrichment.seniority?.value) badges.appendChild(textBadge(capitalize(enrichment.seniority.value)))
  if (enrichment.yoe?.value != null) badges.appendChild(textBadge(`${enrichment.yoe.value} yoe`))
  if (hit.postedAgo?.text) badges.appendChild(textBadge(hit.postedAgo.text, 'muted'))
  li.appendChild(badges)

  if (job.description) {
    const desc = document.createElement('p')
    desc.className = 'job-desc'
    desc.textContent = stripHtml(job.description)
    li.appendChild(desc)
  }

  const skills = enrichment.skills ?? []
  if (skills.length) {
    const matched = new Set(hit.matchedSkills ?? [])
    const skillRow = document.createElement('div')
    skillRow.className = 'badges'
    for (const skill of skills) {
      const b = document.createElement('span')
      b.className = 'badge skill' + (matched.has(skill.id) ? ' matched' : '')
      b.textContent = skill.label
      skillRow.appendChild(b)
    }
    li.appendChild(skillRow)
  }

  return li
}

function qualificationBadge(qualification) {
  const confirmed = qualification === 'confirmed'
  return textBadge(confirmed ? '✓ confirmed match' : '~ assumed match', confirmed ? 'qual-confirmed' : 'qual-assumed')
}

function scoreBadge(score) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100)
  const span = document.createElement('span')
  span.className = 'badge'
  const label = document.createTextNode(`score ${pct}% `)
  const track = document.createElement('span')
  track.className = 'score-bar-track'
  const fill = document.createElement('span')
  fill.className = 'score-bar-fill'
  fill.style.width = `${pct}%`
  track.appendChild(fill)
  span.appendChild(label)
  span.appendChild(track)
  return span
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
// Client-side keyword filter over the currently loaded results — the API has
// no free-text search, so this fills that gap without needing a server-side DB.
// ---------------------------------------------------------------------------

function applyFilter() {
  const query = filterInput.value.trim().toLowerCase()
  const cards = resultsList.querySelectorAll('.job-card')
  let visible = 0
  cards.forEach(card => {
    const match = !query || card.dataset.searchText.includes(query)
    card.classList.toggle('hidden-by-filter', !match)
    if (match) visible++
  })
  resultsCount.textContent = results.length ? (query ? `(${visible}/${results.length})` : `(${results.length})`) : ''
}

function buildSearchText(hit) {
  const job = hit.job?.job ?? {}
  const skills = (hit.job?.enrichment?.skills ?? []).map(s => s.label)
  return [job.title, job.company, job.location, job.platformId, stripHtml(job.description ?? ''), ...skills, ...(hit.matchedSkills ?? [])]
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

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function toBase64Json(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function formatNumber(n) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
}

function formatSalary(hit) {
  const extraction = hit.job?.enrichment?.salary?.value
  if (extraction && (extraction.min != null || extraction.max != null)) {
    const currency = extraction.currency ? `${extraction.currency} ` : ''
    const period = extraction.period ? `/${extraction.period}` : ''
    let range
    if (extraction.min != null && extraction.max != null) range = `${formatNumber(extraction.min)}–${formatNumber(extraction.max)}`
    else if (extraction.min != null) range = `${formatNumber(extraction.min)}+`
    else range = `up to ${formatNumber(extraction.max)}`
    return `${currency}${range}${period}`
  }
  return hit.job?.job?.salary || null
}

function stripHtml(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

function capitalize(text) {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text
}
