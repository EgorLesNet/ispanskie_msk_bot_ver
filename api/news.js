const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = 'db.json'
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'fusuges').toLowerCase()

let memoryDB = null
let lastGitHubSync = null

async function loadFromGitHub() {
  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${DB_FILE_PATH}`
    const response = await fetch(url)
    if (response.ok) {
      const data = await response.json()
      memoryDB = data
      lastGitHubSync = new Date().toISOString()
      console.log('Loaded from GitHub:', data.posts.length, 'posts')
      return data
    }
  } catch (err) {
    console.error('Error loading from GitHub:', err)
  }
  return { posts: [], seq: 0 }
}

async function getDB() {
  if (!memoryDB) {
    memoryDB = await loadFromGitHub()
  }
  return memoryDB
}

async function saveToGitHub(db) {
  try {
    const getUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`
    const getResponse = await fetch(getUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
    
    const fileData = await getResponse.json()
    const sha = fileData.sha
    
    const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64')
    const updateResponse = await fetch(getUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Daily backup via API',
        content: content,
        sha: sha
      })
    })
    
    lastGitHubSync = new Date().toISOString()
    return updateResponse.ok
  } catch (err) {
    console.error('Error saving to GitHub:', err)
    return false
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  const db = await getDB()
  
  if (req.method === 'GET') {
    const sync = req.query.sync
    if (sync === 'github') {
      const success = await saveToGitHub(db)
      return res.status(200).json({ success, lastSync: lastGitHubSync, posts: db.posts.length })
    }
    return res.status(200).json(db)
  }
  
  if (req.method === 'DELETE') {
    const urlParts = req.url.split('/')
    const postId = parseInt(urlParts[urlParts.length - 1])
    const { admin } = req.query
    
    if (!admin || admin.toLowerCase() !== ADMIN_USERNAME) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    
    const postIndex = db.posts.findIndex(p => p.id === postId)
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' })
    }
    
    db.posts.splice(postIndex, 1)
    memoryDB = db
    
    return res.status(200).json({ success: true })
  }
  
  return res.status(405).json({ error: 'Method not allowed' })
}
