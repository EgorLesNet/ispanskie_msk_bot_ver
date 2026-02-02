// api/profile.js - API для обновления профиля пользователя
module.exports = async (req, res) => {
  // CORS headers
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
    
    // Проверка URL аватарки (если указан)
    if (photoUrl && !isValidUrl(photoUrl)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Некорректный URL аватарки' 
      });
    }
    
    // Формируем обновленные данные пользователя
    const updatedUser = {
      tgId,
      displayName: displayName.trim(),
      photoUrl: photoUrl || null,
      updatedAt: new Date().toISOString()
    };
    
    console.log('[PROFILE] Updated user:', updatedUser);
    
    return res.status(200).json({
      success: true,
      user: updatedUser,
      message: 'Профиль успешно обновлен'
    });
    
  } catch (error) {
    console.error('[PROFILE] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Ошибка обновления профиля',
      error: error.message
    });
  }
};

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:';
  } catch (_) {
    return false;
  }
}