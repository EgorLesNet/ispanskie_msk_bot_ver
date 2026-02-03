// lib/db.js - Единый модуль для работы с базой данных
require('dotenv/config');
const https = require('https');

const GITHUB_REPO = process.env.GITHUB_REPO || 'EgorLesNet/ispanskie_msk_bot_ver';
const DB_FILE_PATH = process.env.DB_FILE_PATH || 'db.json';
const DB_BRANCH = process.env.DB_BRANCH || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Кэш для уменьшения запросов к GitHub
let dbCache = null;
let cacheTime = 0;
const CACHE_TTL = 2000; // 2 секунды (сокращено с 5 секунд)

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'ispanskie-bot',
        ...headers
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ data, statusCode: res.statusCode });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

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
 * Чтение базы данных из GitHub
 * @param {boolean} useCache - Использовать кэш
 * @returns {Promise<{sha: string|null, db: object}>}
 */
async function readDB(useCache = true) {
  // Проверяем кэш
  if (useCache && dbCache && (Date.now() - cacheTime) < CACHE_TTL) {
    return { sha: dbCache.sha, db: dbCache.db };
  }

  try {
    // Читаем через GitHub API вместо Raw URL
    // Raw URL кэшируется на 5 минут!
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}?ref=${encodeURIComponent(DB_BRANCH)}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ispanskie-bot'
    };
    
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    }

    const { data: apiData } = await httpsGet(apiUrl, headers);
    const json = JSON.parse(apiData);
    
    // Декодируем base64 контент
    const content = Buffer.from(json.content, 'base64').toString('utf8');
    const db = normalizeDb(JSON.parse(content));
    const sha = json.sha || null;

    // Обновляем кэш
    dbCache = { sha, db };
    cacheTime = Date.now();

    console.log('[DB] Read from GitHub API, posts:', db.posts.length, 'pending:', db.pending.length);

    return { sha, db };
  } catch (error) {
    console.error('readDB error:', error);
    // Возвращаем кэш даже если он устарел
    if (dbCache) {
      return { sha: dbCache.sha, db: dbCache.db };
    }
    // Или пустую базу
    return { sha: null, db: normalizeDb({}) };
  }
}

/**
 * Запись базы данных в GitHub
 * @param {object} db - База данных
 * @param {string|null} sha - SHA текущего файла
 * @returns {Promise<Response>}
 */
async function writeDB(db, sha) {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required for write operations');
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`;
  const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64');

  const body = {
    message: 'Update news via bot',
    content,
    branch: DB_BRANCH
  };
  if (sha) body.sha = sha;

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'ispanskie-bot'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        // Очищаем кэш после записи
        dbCache = null;
        cacheTime = 0;

        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[DB] Write successful, status:', res.statusCode);
          resolve({ ok: true, statusCode: res.statusCode, data });
        } else {
          console.error('[DB] Write failed:', res.statusCode, data);
          reject(new Error(`GitHub write failed: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Обновление базы с повторными попытками при конфликтах
 * @param {Function} mutator - Функция, которая изменяет db
 * @param {number} retries - Количество попыток
 * @returns {Promise<any>}
 */
async function updateDB(mutator, retries = 5) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      // Читаем без кэша, чтобы получить последнюю версию
      const { sha, db } = await readDB(false);
      
      // Применяем изменения
      const result = await mutator(db);
      
      // Записываем
      const writeResult = await writeDB(db, sha);
      
      if (writeResult.ok) {
        return result;
      }
      
      throw new Error('Write failed');
    } catch (error) {
      lastError = error;
      
      // Если конфликт (409), повторяем
      if (error.message.includes('409')) {
        console.log(`[DB] Conflict detected, retry ${i + 1}/${retries}`);
        await new Promise(r => setTimeout(r, 100 * (i + 1))); // Экспоненциальная задержка
        continue;
      }
      
      // Другие ошибки - пробрасываем
      throw error;
    }
  }
  
  throw lastError || new Error('updateDB failed after retries');
}

/**
 * Очистить кэш (используйте после изменений)
 */
function clearCache() {
  dbCache = null;
  cacheTime = 0;
}

module.exports = {
  readDB,
  writeDB,
  updateDB,
  normalizeDb,
  clearCache
};