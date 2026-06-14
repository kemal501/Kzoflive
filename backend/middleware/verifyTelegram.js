import crypto from 'crypto';

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return false;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    // Filter out hash and sort keys alphabetically
    const keys = Array.from(params.keys())
      .filter((key) => key !== 'hash')
      .sort();

    const dataCheckString = keys
      .map((key) => `${key}=${params.get(key)}`)
      .join('\n');

    // Generate secret key using HMAC-SHA256 with "WebAppData"
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Generate validation hash
    const validationHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return validationHash === hash;
  } catch (err) {
    console.error('Error verifying Telegram initData:', err);
    return false;
  }
}

export default (req, res, next) => {
  const initData = req.headers['x-telegram-init-data'];
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  // In development, if no token or initData is given, bypass with simulated mock headers for easy testing
  if (process.env.NODE_ENV !== 'production' && (!initData || !botToken)) {
    req.telegramUser = {
      id: '123456789',
      username: 'mock_user',
      first_name: 'Test',
      last_name: 'User',
      language_code: 'en'
    };
    return next();
  }

  if (!initData) {
    return res.status(401).json({ error: 'Missing Telegram authentication header' });
  }

  if (!verifyTelegramInitData(initData, botToken)) {
    return res.status(403).json({ error: 'Invalid Telegram authentication checksum' });
  }

  try {
    const params = new URLSearchParams(initData);
    const userString = params.get('user');
    if (userString) {
      req.telegramUser = JSON.parse(userString);
    }
    next();
  } catch (err) {
    return res.status(400).json({ error: 'Malformed user payload inside init data' });
  }
};
