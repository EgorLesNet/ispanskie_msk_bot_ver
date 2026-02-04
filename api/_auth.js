// api/_auth.js - Authentication & Profile Management (module, not a function)
require('dotenv/config');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTH_CODE_SECRET = process.env.AUTH_CODE_SECRET || BOT_TOKEN; // fallback, but лучше задать отдельный секрет

if (!BOT_TOKEN) {
  console.error('[AUTH] BOT_TOKEN is not set!');
}

if (!AUTH_CODE_SECRET) {
  console.error('[AUTH] AUTH_CODE_SECRET is not set (and BOT_TOKEN missing), auth code exchange will not work!');
}

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const result = {};

  for (const [key, value] of params.entries()) {
    if (key === 'user') {
      try {
        result[key] = JSON.parse(value);
      } catch (e) {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

function verifyTelegramWebAppData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    if (!hash) {
      return { valid: false, error: 'Missing hash in initData' };
    }

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      console.error('[AUTH] Hash mismatch');
      return { valid: false, error: 'Data verification failed' };
    }

    const userJson = urlParams.get('user');
    if (!userJson) {
      return { valid: false, error: 'Missing user data' };
    }

    const user = JSON.parse(userJson);
    const authDate = parseInt(urlParams.get('auth_date') || '0');

    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime - authDate > 86400) {
      return { valid: false, error: 'Auth data is outdated (>24h)' };
    }

    return {
      valid: true,
      user: {
        id: user.id,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        username: user.username || '',
        photoUrl: user.photo_url || '',
        languageCode: user.language_code || '',
        authDate
      }
    };

  } catch (error) {
    console.error('[AUTH] Verification error:', error);
    return { valid: false, error: 'Verification failed: ' + error.message };
  }
}

function verifyTelegramAuth(data) {
  const { hash, ...authData } = data;

  if (!hash || !authData.id) {
    return { valid: false, error: 'Missing required fields' };
  }

  const checkArray = Object.keys(authData)
    .sort()
    .map(key => `${key}=${authData[key]}`);
  const dataCheckString = checkArray.join('\n');

  const secretKey = crypto.createHash('sha256')
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    return { valid: false, error: 'Data is NOT from Telegram' };
  }

  const authDate = parseInt(authData.auth_date);
  const currentTime = Math.floor(Date.now() / 1000);

  if (currentTime - authDate > 86400) {
    return { valid: false, error: 'Auth data is outdated' };
  }

  return {
    valid: true,
    user: {
      id: parseInt(authData.id),
      firstName: authData.first_name || '',
      lastName: authData.last_name || '',
      username: authData.username || '',
      photoUrl: authData.photo_url || '',
      authDate
    }
  };
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString();
}

function signAuthCode(payloadB64) {
  if (!AUTH_CODE_SECRET) return null;
  const sig = crypto.createHmac('sha256', AUTH_CODE_SECRET).update(payloadB64).digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return sig;
}

function generateAuthCode(userPayload, ttlSeconds = 180) {
  if (!AUTH_CODE_SECRET) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    u: userPayload,
    iat: now,
    exp: now + ttlSeconds
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = signAuthCode(payloadB64);
  if (!sig) return null;
  return `${payloadB64}.${sig}`;
}

function verifyAuthCode(code) {
  if (!AUTH_CODE_SECRET) return { valid: false, error: 'AUTH_CODE_SECRET not set' };
  if (!code || typeof code !== 'string') return { valid: false, error: 'Missing code' };

  const parts = code.split('.');
  if (parts.length !== 2) return { valid: false, error: 'Invalid code format' };

  const [payloadB64, sig] = parts;
  const expected = signAuthCode(payloadB64);
  if (!expected || expected !== sig) return { valid: false, error: 'Invalid signature' };

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch (e) {
    return { valid: false, error: 'Invalid payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now > payload.exp) return { valid: false, error: 'Code expired' };
  if (!payload.u) return { valid: false, error: 'Missing user in code' };

  return { valid: true, user: payload.u };
}

async function handleAuth(req, res) {
  try {
    let verification;

    if (req.body.initData && typeof req.body.initData === 'string') {
      console.log('[AUTH] Using Telegram Web App initData validation');
      verification = verifyTelegramWebAppData(req.body.initData);
    }
    else if (req.body.id || req.body.hash) {
      console.log('[AUTH] Using legacy Telegram auth validation');
      verification = verifyTelegramAuth(req.body);
    }
    else {
      console.error('[AUTH] No valid authentication data provided');
      return res.status(400).json({
        error: 'Bad request',
        message: 'No valid authentication data provided'
      });
    }

    if (!verification.valid) {
      console.error('[AUTH] Verification failed:', verification.error);
      return res.status(401).json({
        error: 'Authentication failed',
        message: verification.error
      });
    }

    console.log('[AUTH] Authentication successful for user:', verification.user.id);

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const user = verification.user;

    const userPayload = {
      tgId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      displayName: user.firstName + (user.lastName ? ' ' + user.lastName : '')
    };

    const authCode = generateAuthCode(userPayload);

    return res.status(200).json({
      success: true,
      token: sessionToken,
      authCode,
      user: userPayload
    });

  } catch (error) {
    console.error('[AUTH] Error:', error);
    return res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
}

async function handleAuthExchange(req, res) {
  try {
    const code = req.body.code || req.body.authCode || req.body.auth_code;
    const verification = verifyAuthCode(code);

    if (!verification.valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid code',
        message: verification.error
      });
    }

    return res.status(200).json({
      success: true,
      user: verification.user
    });

  } catch (error) {
    console.error('[AUTH_EXCHANGE] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
}

async function handleProfileUpdate(req, res) {
  try {
    const { tgId, displayName, photoUrl } = req.body;

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

    if (photoUrl && !isValidUrl(photoUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Некорректный URL аватарки'
      });
    }

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
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:';
  } catch (_) {
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // Под-роуты под /api/auth/* приходят сюда через router.js
  if (path === '/api/auth/exchange' || path === '/api/auth/exchange/') {
    return handleAuthExchange(req, res);
  }

  const action = req.query?.action || (req.body.tgId && req.body.displayName ? 'updateProfile' : 'auth');

  if (action === 'updateProfile') {
    return handleProfileUpdate(req, res);
  } else {
    return handleAuth(req, res);
  }
};
