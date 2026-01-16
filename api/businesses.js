const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = 'db.json'
const DB_BRANCH = process.env.DB_BRANCH || 'main'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const BUSINESS_ADMIN_KEY = process.env.BUSINESS_ADMIN_KEY || ''

function normalizeDb(raw) {
  const db = raw && typeof raw === 'object' ? raw : {}
  return {
    posts: Array.isArray(db.posts) ? db.posts : [],
    pending: Array.isArray(db.pending) ? db.pending : [],
    rejected: Array.isArray(db.rejected) ? db.rejected : [],
    businesses: Array.isArray(db.businesses) ? db.businesses : []
  }
}

async function readDbFile() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}?ref=${encodeURIComponent(DB_BRANCH)}`
  const resp = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      ...(GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {})
    },
    cache: 'no-store'
  })

  if (!resp.ok) {
    if (resp.status === 404) return { sha: null, db: normalizeDb({}) }
    const t = await resp.text().catch(() => '')
    throw new Error(`GitHub read failed: ${resp.status} ${t}`)
  }

  const json = await resp.json()
  const sha = json?.sha || null
  const contentB64 = json?.content || ''
  const buf = Buffer.from(contentB64, 'base64')
  const text = buf.toString('utf8')
  const data = JSON.parse(text)
  return { sha, db: normalizeDb(data) }
}

async function writeDbFile(db, sha) {
  if (!GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN')

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`
  const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64')

  const body = { message: 'Update businesses via site', content, branch: DB_BRANCH }
  if (sha) body.sha = sha

  const resp = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  return resp
}

async function updateDB(mutator, retries = 5) {
  let lastErr = null
  for (let i = 0; i < retries; i++) {
    try {
      const { sha, db } = await readDbFile()
      const result = await mutator(db)
      const putResp = await writeDbFile(db, sha)

      if (putResp.ok) return result

      const txt = await putResp.text().catch(() => '')
      lastErr = new Error(`GitHub write failed: ${putResp.status} ${txt}`)
      if (putResp.status === 409) continue // sha conflict -> retry
      throw lastErr
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('updateDB failed')
}

function parseBody(req) {
  const b = req.body
  if (!b) return null
  if (typeof b === 'string') {
    try { return JSON.parse(b) } catch { return null }
  }
  if (Buffer.isBuffer(b)) {
    try { return JSON.parse(b.toString('utf8')) } catch { return null }
  }
  return b
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    try {
      const { db } = await readDbFile()
      return res.status(200).json({ businesses: db.businesses })
    } catch (e) {
      console.error('GET /api/businesses error:', e)
      return res.status(500).json({ error: 'Failed to load businesses' })
    }
  }

  if (req.method === 'POST') {
    try {
      const body = parseBody(req) || {}
      const { secret, name, category, lat, lng, description, address, url } = body

      if (!BUSINESS_ADMIN_KEY) {
        return res.status(500).json({ error: 'BUSINESS_ADMIN_KEY is not set' })
      }
      if (!secret || secret !== BUSINESS_ADMIN_KEY) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const cleanName = String(name || '').trim()
      const cleanCategory = String(category || '').trim()
      const cleanDesc = String(description || '').trim()
      const cleanAddr = String(address || '').trim()
      const cleanUrl = String(url || '').trim()

      const nLat = Number(lat)
      const nLng = Number(lng)

      if (!cleanName) return res.status(400).json({ error: 'name is required' })
      if (!cleanCategory) return res.status(400).json({ error: 'category is required' })
      if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return res.status(400).json({ error: 'lat/lng invalid' })

      const saved = await updateDB(async (db) => {
        const ids = db.businesses.map(x => x.id).filter(x => typeof x === 'number')
        const id = ids.length ? Math.max(...ids) + 1 : 1

        const item = {
          id,
          name: cleanName,
          category: cleanCategory,
          lat: nLat,
          lng: nLng,
          description: cleanDesc || null,
          address: cleanAddr || null,
          url: cleanUrl || null,
          createdAt: new Date().toISOString()
        }

        db.businesses.unshift(item)
        return item
      })

      return res.status(200).json({ ok: true, business: saved })
    } catch (e) {
      console.error('POST /api/businesses error:', e)
      return res.status(500).json({ error: 'Failed to save business' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
