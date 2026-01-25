require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./database');
// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'files');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    if (ext !== '.pine' && ext !== '.txt') {
      return cb(new Error('Only .pine and .txt files are allowed'));
    }
    cb(null, true);
  }
});
const payments = require('./payments');

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// ID администратора для уведомлений (твой Telegram ID)
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// Инициализация Express сервера
const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting для защиты от брутфорса
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 5, // максимум 5 попыток
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 100, // 100 запросов в минуту
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', apiLimiter);

// ===== ФУНКЦИИ ПОДПИСОК =====

// Создание подписки после оплаты
function createSubscription(userId, productId, purchaseId, tradingviewUsername) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  const durationDays = product.duration_days || 30;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + durationDays);

  const stmt = db.prepare(`
    INSERT INTO subscriptions (user_id, product_id, purchase_id, tradingview_username, end_date)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(userId, productId, purchaseId, tradingviewUsername, endDate.toISOString());

  return { endDate, durationDays, indicator: product.tradingview_indicator };
}

// Отправка уведомления админу о новой подписке
async function notifyAdminNewSubscription(user, product, tradingviewUsername, endDate) {
  if (!ADMIN_TELEGRAM_ID) return;

  const message = `🆕 НОВАЯ ПОДПИСКА!\n\n` +
    `👤 Клиент: ${user.first_name || user.username || 'ID:' + user.telegram_id}\n` +
    `📊 TradingView: @${tradingviewUsername}\n` +
    `📦 Индикатор: ${product.tradingview_indicator || product.name}\n` +
    `⏰ До: ${new Date(endDate).toLocaleDateString('ru-RU')}\n\n` +
    `✅ Добавь @${tradingviewUsername} к индикатору!`;

  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, message);
}

// Отправка уведомления админу об истёкшей подписке
async function notifyAdminExpiredSubscription(subscription) {
  if (!ADMIN_TELEGRAM_ID) return;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(subscription.user_id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(subscription.product_id);

  const message = `⛔ ПОДПИСКА ИСТЕКЛА!\n\n` +
    `👤 Клиент: ${user.first_name || user.username || 'ID:' + user.telegram_id}\n` +
    `📊 TradingView: @${subscription.tradingview_username}\n` +
    `📦 Индикатор: ${product.tradingview_indicator || product.name}\n\n` +
    `❌ Удали @${subscription.tradingview_username} из индикатора!`;

  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, message);
}

// Проверка истекающих и истёкших подписок
async function checkSubscriptions() {
  console.log('🔄 Проверка подписок...');

  const now = new Date();
  const threeDaysLater = new Date();
  threeDaysLater.setDate(now.getDate() + 3);

  // Подписки истекающие через 3 дня (напоминание клиенту)
  const expiringSoon = db.prepare(`
    SELECT s.*, u.telegram_id, u.first_name, p.name as product_name
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    JOIN products p ON s.product_id = p.id
    WHERE s.status = 'active'
      AND s.notified_3days = 0
      AND s.end_date <= ?
      AND s.end_date > ?
  `).all(threeDaysLater.toISOString(), now.toISOString());

  for (const sub of expiringSoon) {
    try {
      await bot.telegram.sendMessage(sub.telegram_id,
        `⚠️ Ваша подписка на "${sub.product_name}" истекает через 3 дня!\n\n` +
        `📅 Дата окончания: ${new Date(sub.end_date).toLocaleDateString('ru-RU')}\n\n` +
        `Продлите подписку в нашем магазине, чтобы не потерять доступ.`
      );
      db.prepare('UPDATE subscriptions SET notified_3days = 1 WHERE id = ?').run(sub.id);
    } catch (e) {
      console.error('Error notifying user:', e);
    }
  }

  // Истёкшие подписки
  const expired = db.prepare(`
    SELECT s.*, u.telegram_id, u.first_name
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    WHERE s.status = 'active' AND s.end_date <= ?
  `).all(now.toISOString());

  for (const sub of expired) {
    try {
      // Уведомление клиенту
      await bot.telegram.sendMessage(sub.telegram_id,
        `❌ Ваша подписка истекла!\n\n` +
        `Доступ к индикатору будет отключён.\n` +
        `Продлите подписку в нашем магазине.`
      );

      // Уведомление админу
      await notifyAdminExpiredSubscription(sub);

      // Обновляем статус
      db.prepare(`UPDATE subscriptions SET status = 'expired', notified_expired = 1 WHERE id = ?`).run(sub.id);
    } catch (e) {
      console.error('Error processing expired subscription:', e);
    }
  }

  console.log(`✅ Проверено: ${expiringSoon.length} истекающих, ${expired.length} истёкших`);
}

// Запуск проверки подписок каждый час
setInterval(checkSubscriptions, 60 * 60 * 1000);
// Первая проверка через 1 минуту после старта
setTimeout(checkSubscriptions, 60 * 1000);

// Команда /start
bot.command('start', (ctx) => {
  ctx.reply(
    '👋 Привет! Добро пожаловать в магазин трейдинг индикаторов!\n\n' +
      '🔹 /catalog - Посмотреть каталог\n' +
      '🔹 /help - Помощь\n\n' +
      'Открой мини‑приложение для покупок ⬇️'
  );
});

// Команда /catalog
bot.command('catalog', (ctx) => {
  ctx.reply(
    '📊 Наши индикаторы:\n\n' +
      '1️⃣ RSI Pro – 500₽\n' +
      '2️⃣ MACD Advanced – 700₽\n' +
      '3️⃣ Volume Profile – 1000₽\n\n' +
      'Для покупки откройте мини‑приложение.'
  );
});

// Команда /help
bot.command('help', (ctx) => {
  ctx.reply(
    'ℹ️ Помощь:\n\n' +
      '1) Открой мини‑приложение\n' +
      '2) Выбери индикатор\n' +
      '3) Оплати и скачай файл\n\n' +
      'Поддержка: @your_support'
  );
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Получение товаров
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products').all();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Создание / получение пользователя
app.post('/api/users', (req, res) => {
  const { telegram_id, username, first_name } = req.body;

  try {
    db.prepare(
      'INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)'
    ).run(telegram_id, username || '', first_name || '');

    const user = db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .get(telegram_id);

    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Получение активных подписок пользователя
app.get('/api/subscriptions/:telegram_id', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.params.telegram_id);
    if (!user) {
      return res.json([]);
    }

    const subscriptions = db.prepare(`
      SELECT
        s.id,
        s.tradingview_username,
        s.start_date,
        s.end_date,
        s.status,
        p.name as product_name,
        p.tradingview_indicator,
        p.duration_days
      FROM subscriptions s
      JOIN products p ON s.product_id = p.id
      WHERE s.user_id = ?
      ORDER BY s.end_date DESC
    `).all(user.id);

    res.json(subscriptions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Получение покупок пользователя (legacy)
app.get('/api/purchases/:telegram_id', (req, res) => {
  try {
    const purchases = db
      .prepare(
        `SELECT p.id AS purchase_id, p.amount, p.status, p.created_at,
                pr.name, pr.description, pr.price, pr.file_url
         FROM purchases p
         JOIN users u ON p.user_id = u.id
         JOIN products pr ON p.product_id = pr.id
         WHERE u.telegram_id = ? AND p.status = 'paid'
         ORDER BY p.created_at DESC`
      )
      .all(req.params.telegram_id);

    res.json(purchases);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Создание инвойса
app.post('/api/create-invoice', async (req, res) => {
  const { product_id, telegram_id, tradingview_username } = req.body;

  // Проверка TradingView username
  if (!tradingview_username || tradingview_username.trim().length < 2) {
    return res.status(400).json({
      success: false,
      error: 'Введите ваш TradingView username'
    });
  }

  try {
    // Сохраняем/обновляем пользователя с TradingView username
    db.prepare(
      'INSERT OR IGNORE INTO users (telegram_id) VALUES (?)'
    ).run(telegram_id);

    db.prepare(
      'UPDATE users SET tradingview_username = ? WHERE telegram_id = ?'
    ).run(tradingview_username.trim(), telegram_id);

    const invoice = await payments.createInvoice(product_id, telegram_id, tradingview_username.trim());
    res.json(invoice);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Verify CryptoBot webhook signature
function verifyCryptoBotSignature(body, signature) {
  const secret = crypto.createHash('sha256').update(process.env.CRYPTO_BOT_TOKEN).digest();
  const checkString = JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  return hmac === signature;
}

// Webhook CryptoBot
app.post('/api/crypto-webhook', async (req, res) => {
  try {
    // Verify signature
    const signature = req.headers['crypto-pay-api-signature'];
    if (!verifyCryptoBotSignature(req.body, signature)) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    if (req.body.update_type === 'invoice_paid') {
      const invoice = req.body.payload;
      const payload = JSON.parse(invoice.payload);

      // Обновляем статус покупки
      const purchaseResult = db.prepare(
        `UPDATE purchases SET status = 'paid'
         WHERE id = (
           SELECT id FROM purchases
           WHERE user_id = ? AND product_id = ? AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1
         )`
      ).run(payload.user_id, payload.product_id);

      // Получаем ID покупки
      const purchase = db.prepare(
        `SELECT id FROM purchases
         WHERE user_id = ? AND product_id = ? AND status = 'paid'
         ORDER BY created_at DESC LIMIT 1`
      ).get(payload.user_id, payload.product_id);

      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(payload.product_id);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.user_id);

      // Создаём подписку
      const tradingviewUsername = payload.tradingview_username || user.tradingview_username;
      const subInfo = createSubscription(
        payload.user_id,
        payload.product_id,
        purchase.id,
        tradingviewUsername
      );

      // Уведомление клиенту
      await bot.telegram.sendMessage(
        payload.telegram_id,
        `✅ Оплата получена!\n\n` +
        `📦 ${product.name}\n` +
        `📊 TradingView: @${tradingviewUsername}\n` +
        `⏰ Доступ до: ${subInfo.endDate.toLocaleDateString('ru-RU')}\n\n` +
        `Доступ к индикатору будет предоставлен в течение нескольких минут.`
      );

      // Уведомление админу
      await notifyAdminNewSubscription(user, product, tradingviewUsername, subInfo.endDate);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Webhook / polling
if (process.env.NODE_ENV === 'production') {
  const DOMAIN = 'https://trade-boost.onrender.com';
  bot.telegram.setWebhook(`${DOMAIN}/telegram-webhook`);
  app.use(bot.webhookCallback('/telegram-webhook'));
} else {
  bot.launch();
}
// ===== ADMIN ENDPOINTS =====

// Admin authentication
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.warn('⚠️  WARNING: ADMIN_TOKEN not set! Admin panel will be inaccessible.');
}

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Admin login endpoint (with rate limiting)
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { token } = req.body;
  if (!ADMIN_TOKEN) {
    return res.status(500).json({ success: false, error: 'Admin token not configured' });
  }
  if (token === ADMIN_TOKEN) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// Get sales statistics
app.get('/api/admin/stats', adminAuth, (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_purchases,
        SUM(amount) as total_revenue,
        COUNT(DISTINCT user_id) as total_customers
      FROM purchases
      WHERE status = 'paid'
    `).get();
    
    const recentPurchases = db.prepare(`
      SELECT 
        p.id,
        p.amount,
        p.created_at,
        pr.name as product_name,
        u.username,
        u.first_name
      FROM purchases p
      JOIN products pr ON p.product_id = pr.id
      JOIN users u ON p.user_id = u.id
      WHERE p.status = 'paid'
      ORDER BY p.created_at DESC
      LIMIT 10
    `).all();
    
    res.json({
      stats,
      recent_purchases: recentPurchases
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all purchases
app.get('/api/admin/purchases', adminAuth, (req, res) => {
  try {
    const purchases = db.prepare(`
      SELECT 
        p.id,
        p.amount,
        p.status,
        p.created_at,
        pr.name as product_name,
        u.telegram_id,
        u.username,
        u.first_name
      FROM purchases p
      JOIN products pr ON p.product_id = pr.id
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `).all();
    
    res.json(purchases);
  } catch (error) {
    console.error('Error getting purchases:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all users
app.get('/api/admin/users', adminAuth, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT 
        u.id,
        u.telegram_id,
        u.username,
        u.first_name,
        u.created_at,
        COUNT(p.id) as purchases_count,
        COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0) as total_spent
      FROM users u
      LEFT JOIN purchases p ON u.id = p.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();
    
    res.json(users);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: error.message });
  }
});
// Get all subscriptions
app.get('/api/admin/subscriptions', adminAuth, (req, res) => {
  try {
    const subscriptions = db.prepare(`
      SELECT
        s.id,
        s.tradingview_username,
        s.start_date,
        s.end_date,
        s.status,
        p.name as product_name,
        p.tradingview_indicator,
        u.telegram_id,
        u.username,
        u.first_name
      FROM subscriptions s
      JOIN products p ON s.product_id = p.id
      JOIN users u ON s.user_id = u.id
      ORDER BY s.end_date DESC
    `).all();

    res.json(subscriptions);
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user statistics
app.get('/api/admin/user-stats', adminAuth, (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN id IN (SELECT DISTINCT user_id FROM purchases WHERE status = 'paid') THEN 1 END) as paying_users,
        COUNT(CASE WHEN id NOT IN (SELECT DISTINCT user_id FROM purchases WHERE status = 'paid') THEN 1 END) as non_paying_users
      FROM users
    `).get();
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting user stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add new product
app.post('/api/admin/products', adminAuth, (req, res) => {
  try {
    const { name, description, price, duration_days, tradingview_indicator } = req.body;

    console.log('Creating product:', { name, description, price, duration_days, tradingview_indicator });

    const stmt = db.prepare(`
      INSERT INTO products (name, description, price, duration_days, tradingview_indicator, file_url)
      VALUES (?, ?, ?, ?, ?, NULL)
    `);

    const result = stmt.run(name, description, price, duration_days || 30, tradingview_indicator || '');

    console.log('Product created with ID:', result.lastInsertRowid);

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (error) {
    console.error('Error adding product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update product
app.put('/api/admin/products/:id', adminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, duration_days, tradingview_indicator } = req.body;

    console.log('Updating product:', { id, name, description, price, duration_days, tradingview_indicator });

    const stmt = db.prepare(`
      UPDATE products
      SET name = ?, description = ?, price = ?, duration_days = ?, tradingview_indicator = ?
      WHERE id = ?
    `);

    const result = stmt.run(name, description, price, duration_days || 30, tradingview_indicator || '', id);

    console.log('Product updated, changes:', result.changes);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete product
app.delete('/api/admin/products/:id', adminAuth, (req, res) => {
  try {
    const { id } = req.params;
    
    const stmt = db.prepare('DELETE FROM products WHERE id = ?');
    stmt.run(id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Upload file for product
app.post('/api/admin/products/:id/upload', adminAuth, upload.single('file'), (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    const fileUrl = 'files/' + req.file.filename;
    
    const stmt = db.prepare('UPDATE products SET file_url = ? WHERE id = ?');
    stmt.run(fileUrl, id);
    
    res.json({ 
      success: true, 
      file_url: fileUrl 
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));