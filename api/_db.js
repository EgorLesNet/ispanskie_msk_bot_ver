const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = 'db.json'

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

async function saveToGitHub() {
  const db = await getDB()
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

module.exports = { getDB, saveToGitHub, lastGitHubSync: () => lastGitHubSync }
