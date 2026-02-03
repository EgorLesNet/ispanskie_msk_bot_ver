const fs = require('fs').promises;
const path = require('path');

const USERS_PATH = path.join(__dirname, '..', 'users.json');

/**
 * Получает данные пользователя
 */
async function getUser(tgId) {
  try {
    const data = await fs.readFile(USERS_PATH, 'utf8');
    const usersData = JSON.parse(data);
    
    return usersData.users.find(u => u.tgId === tgId) || null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

/**
 * Создаёт или обновляет пользователя
 */
async function upsertUser(tgId, userData) {
  try {
    let usersData;
    try {
      const data = await fs.readFile(USERS_PATH, 'utf8');
      usersData = JSON.parse(data);
    } catch {
      usersData = { users: [] };
    }
    
    const existingIndex = usersData.users.findIndex(u => u.tgId === tgId);
    
    const user = {
      tgId,
      ...userData,
      updatedAt: new Date().toISOString()
    };
    
    if (existingIndex !== -1) {
      usersData.users[existingIndex] = {
        ...usersData.users[existingIndex],
        ...user
      };
    } else {
      user.createdAt = new Date().toISOString();
      usersData.users.push(user);
    }
    
    await fs.writeFile(USERS_PATH, JSON.stringify(usersData, null, 2));
    return user;
  } catch (error) {
    console.error('Error upserting user:', error);
    throw error;
  }
}

/**
 * Включает/выключает подписку на дайджест
 */
async function toggleDigestSubscription(tgId, enabled) {
  const user = await getUser(tgId);
  
  if (!user) {
    // Создаём нового пользователя
    return await upsertUser(tgId, {
      digestSubscription: enabled
    });
  }
  
  return await upsertUser(tgId, {
    ...user,
    digestSubscription: enabled
  });
}

/**
 * Получает всех подписанных на дайджест пользователей
 */
async function getDigestSubscribers() {
  try {
    const data = await fs.readFile(USERS_PATH, 'utf8');
    const usersData = JSON.parse(data);
    
    return usersData.users.filter(u => u.digestSubscription === true);
  } catch (error) {
    console.error('Error getting subscribers:', error);
    return [];
  }
}

module.exports = {
  getUser,
  upsertUser,
  toggleDigestSubscription,
  getDigestSubscribers
};