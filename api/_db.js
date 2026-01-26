// api/_db.js - Database module using Vercel KV
const { kv } = require('@vercel/kv');

// Fallback to local file system for development
const fs = require('fs');
const path = require('path');

const IS_VERCEL = !!process.env.VERCEL || !!process.env.KV_REST_API_URL;
const LOCAL_DB_PATH = path.join(process.cwd(), 'db.json');

// Cache for local development
let localCache = null;

function normalizeDb(raw) {
  const db = raw && typeof raw === 'object' ? raw : {};
  return {
    posts: Array.isArray(db.posts) ? db.posts : [],
    pending: Array.isArray(db.pending) ? db.pending : [],
    rejected: Array.isArray(db.rejected) ? db.rejected : [],
    businesses: Array.isArray(db.businesses) ? db.businesses : []
  };
}

/**
 * Read database from KV (Vercel) or local file (development)
 * @param {boolean} useCache - Use cache for local dev
 * @returns {Promise<{sha: string|null, db: object}>}
 */
async function readDB(useCache = true) {
  if (IS_VERCEL) {
    try {
      // Read from Vercel KV
      const db = await kv.get('ispanskie_db');
      return {
        sha: null, // KV doesn't need SHA
        db: normalizeDb(db)
      };
    } catch (error) {
      console.error('KV read error:', error);
      return { sha: null, db: normalizeDb({}) };
    }
  } else {
    // Local development - use file system
    if (useCache && localCache) {
      return { sha: null, db: localCache };
    }

    try {
      if (fs.existsSync(LOCAL_DB_PATH)) {
        const text = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
        const db = normalizeDb(JSON.parse(text));
        localCache = db;
        return { sha: null, db };
      }
    } catch (error) {
      console.error('Local file read error:', error);
    }

    return { sha: null, db: normalizeDb({}) };
  }
}

/**
 * Write database to KV (Vercel) or local file (development)
 * @param {object} db - Database object
 * @param {string|null} sha - Ignored for KV
 * @returns {Promise<{ok: boolean}>}
 */
async function writeDB(db, sha = null) {
  if (IS_VERCEL) {
    try {
      // Write to Vercel KV
      await kv.set('ispanskie_db', db);
      return { ok: true, statusCode: 200 };
    } catch (error) {
      console.error('KV write error:', error);
      throw new Error(`KV write failed: ${error.message}`);
    }
  } else {
    // Local development - write to file
    try {
      fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
      localCache = db;
      return { ok: true, statusCode: 200 };
    } catch (error) {
      console.error('Local file write error:', error);
      throw new Error(`File write failed: ${error.message}`);
    }
  }
}

/**
 * Update database with retry logic
 * @param {Function} mutator - Function that modifies db
 * @param {number} retries - Number of retries
 * @returns {Promise<any>}
 */
async function updateDB(mutator, retries = 3) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      // Read current state
      const { db } = await readDB(false);
      
      // Apply changes
      const result = await mutator(db);
      
      // Write back
      const writeResult = await writeDB(db);
      
      if (writeResult.ok) {
        return result;
      }
      
      throw new Error('Write failed');
    } catch (error) {
      lastError = error;
      console.log(`Update failed, retry ${i + 1}/${retries}:`, error.message);
      
      // Wait before retry
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 100 * (i + 1)));
      }
    }
  }
  
  throw lastError || new Error('updateDB failed after retries');
}

/**
 * Clear local cache
 */
function clearCache() {
  localCache = null;
}

module.exports = {
  readDB,
  writeDB,
  updateDB,
  normalizeDb,
  clearCache
};
