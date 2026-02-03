// lib/users.js - Модуль для работы с пользователями через GitHub
require('dotenv/config');
const https = require('https');

const GITHUB_REPO = process.env.GITHUB_REPO || 'EgorLesNet/ispanskie_msk_bot_ver';
const USERS_FILE_PATH = 'digest-subscribers.json';
const USERS_BRANCH = process.env.DB_BRANCH || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Кэш для уменьшения запросов к GitHub
let usersCache = null;
let cacheTime = 0;
const CACHE_TTL = 2000; // 2 секунды

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

function normalizeUsers(raw) {
  const users = raw && typeof raw === 'object' ? raw : {};
  return {
    subscribers: Array.isArray(users.subscribers) ? users.subscribers : []
  };
}

/**
 * Чтение данных пользователей из GitHub
 * @param {boolean} useCache - Использовать кэш
 * @returns {Promise<{sha: string|null, users: object}>}
 */
async function readUsers(useCache = true) {
  // Проверяем кэш
  if (useCache && usersCache && (Date.now() - cacheTime) < CACHE_TTL) {
    return { sha: usersCache.sha, users: usersCache.users };
  }

  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${USERS_FILE_PATH}?ref=${encodeURIComponent(USERS_BRANCH)}`;
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
    const users = normalizeUsers(JSON.parse(content));
    const sha = json.sha || null;

    // Обновляем кэш
    usersCache = { sha, users };
    cacheTime = Date.now();

    console.log('[USERS] Read from GitHub API, subscribers:', users.subscribers.length);

    return { sha, users };
  } catch (error) {
    console.error('[USERS] readUsers error:', error);
    // Возвращаем кэш даже если он устарел
    if (usersCache) {
      return { sha: usersCache.sha, users: usersCache.users };
    }
    // Или пустые данные
    return { sha: null, users: normalizeUsers({}) };
  }
}

/**
 * Запись данных пользователей в GitHub
 * @param {object} users - Данные пользователей
 * @param {string|null} sha - SHA текущего файла
 * @returns {Promise<Response>}
 */
async function writeUsers(users, sha) {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required for write operations');
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${USERS_FILE_PATH}`;
  const content = Buffer.from(JSON.stringify(users, null, 2)).toString('base64');

  const body = {
    message: 'Update digest subscribers',
    content,
    branch: USERS_BRANCH
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
        usersCache = null;
        cacheTime = 0;

        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[USERS] Write successful, status:', res.statusCode);
          resolve({ ok: true, statusCode: res.statusCode, data });
        } else {
          console.error('[USERS] Write failed:', res.statusCode, data);
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
 * Обновление данных с повторными попытками при конфликтах
 * @param {Function} mutator - Функция, которая изменяет users
 * @param {number} retries - Количество попыток
 * @returns {Promise<any>}
 */
async function updateUsers(mutator, retries = 5) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      // Читаем без кэша, чтобы получить последнюю версию
      const { sha, users } = await readUsers(false);
      
      // Применяем изменения
      const result = await mutator(users);
      
      // Записываем
      const writeResult = await writeUsers(users, sha);
      
      if (writeResult.ok) {
        return result;
      }
      
      throw new Error('Write failed');
    } catch (error) {
      lastError = error;
      
      // Если конфликт (409), повторяем
      if (error.message.includes('409')) {
        console.log(`[USERS] Conflict detected, retry ${i + 1}/${retries}`);
        await new Promise(r => setTimeout(r, 100 * (i + 1))); // Экспоненциальная задержка
        continue;
      }
      
      // Другие ошибки - пробрасываем
      throw error;
    }
  }
  
  throw lastError || new Error('updateUsers failed after retries');
}

/**
 * Получает данные пользователя
 */
async function getUser(tgId) {
  try {
    const { users } = await readUsers();
    return users.subscribers.find(u => u.tgId === tgId) || null;
  } catch (error) {
    console.error('[USERS] Error getting user:', error);
    return null;
  }
}

/**
 * Включает/выключает подписку на дайджест
 */
async function toggleDigestSubscription(tgId, enabled) {
  return await updateUsers(async (users) => {
    const existingIndex = users.subscribers.findIndex(u => u.tgId === tgId);
    
    const user = {
      tgId,
      digestSubscription: enabled,
      updatedAt: new Date().toISOString()
    };
    
    if (existingIndex !== -1) {
      if (enabled) {
        // Обновляем существующего пользователя
        users.subscribers[existingIndex] = {
          ...users.subscribers[existingIndex],
          ...user
        };
      } else {
        // Удаляем пользователя из подписчиков
        users.subscribers.splice(existingIndex, 1);
      }
    } else if (enabled) {
      // Добавляем нового подписчика
      user.createdAt = new Date().toISOString();
      users.subscribers.push(user);
    }
    
    return user;
  });
}

/**
 * Получает всех подписанных на дайджест пользователей
 */
async function getDigestSubscribers() {
  try {
    const { users } = await readUsers();
    return users.subscribers.filter(u => u.digestSubscription === true);
  } catch (error) {
    console.error('[USERS] Error getting subscribers:', error);
    return [];
  }
}

/**
 * Очистить кэш (используйте после изменений)
 */
function clearCache() {
  usersCache = null;
  cacheTime = 0;
}

module.exports = {
  getUser,
  toggleDigestSubscription,
  getDigestSubscribers,
  clearCache
};