// api/profile.js - Обновление профиля пользователя
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'db', 'users.json');

/**
 * Загрузить пользователей из БД
 */
function loadUsers() {
  try {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    if (!fs.existsSync(DB_PATH)) {
      return { users: [] };
    }
    
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[API/PROFILE] Error reading users:', e);
    return { users: [] };
  }
}

/**
 * Сохранить пользователей в БД
 */
function saveUsers(data) {
  try {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[API/PROFILE] Error saving users:', e);
    return false;
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { tgId, displayName, photoUrl } = req.body;
    
    // Валидация
    if (!tgId) {
      return res.status(400).json({
        success: false,
        message: 'tgId обязателен'
      });
    }
    
    if (!displayName || displayName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Имя не может быть пустым'
      });
    }
    
    if (displayName.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Имя слишком длинное (максимум 50 символов)'
      });
    }
    
    // Загрузить пользователей
    const db = loadUsers();
    const users = db.users || [];
    
    // Найти пользователя
    const userIndex = users.findIndex(u => String(u.tgId) === String(tgId));
    
    if (userIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Пользователь не найден'
      });
    }
    
    // Обновить данные
    users[userIndex].displayName = displayName.trim();
    users[userIndex].photoUrl = photoUrl || null;
    users[userIndex].updatedAt = new Date().toISOString();
    
    // Сохранить
    const saved = saveUsers({ users });
    
    if (!saved) {
      return res.status(500).json({
        success: false,
        message: 'Ошибка сохранения данных'
      });
    }
    
    console.log(`[API/PROFILE] Updated profile for tgId=${tgId}`);
    
    return res.status(200).json({
      success: true,
      user: users[userIndex]
    });
    
  } catch (error) {
    console.error('[API/PROFILE] Error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Ошибка сервера'
    });
  }
};
