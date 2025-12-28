require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

// Инициализация Express сервера
const app = express();
app.use(cors());
app.use(express.json());

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

// Получение покупок пользователя
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
  const { product_id, telegram_id } = req.body;

  try {
    db.prepare(
      'INSERT OR IGNORE INTO users (telegram_id) VALUES (?)'
    ).run(telegram_id);

    const invoice = await payments.createInvoice(product_id, telegram_id);
    res.json(invoice);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Webhook CryptoBot
app.post('/api/crypto-webhook', async (req, res) => {
  try {
    if (req.body.update_type === 'invoice_paid') {
      const invoice = req.body.payload;
      const payload = JSON.parse(invoice.payload);

      db.prepare(
        `UPDATE purchases SET status = 'paid'
         WHERE user_id = ? AND product_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`
      ).run(payload.user_id, payload.product_id);

      const product = db
        .prepare('SELECT * FROM products WHERE id = ?')
        .get(payload.product_id);

      await bot.telegram.sendMessage(
        payload.telegram_id,
        `✅ Оплата получена!\n\n📦 ${product.name}`
      );

      if (product.file_url) {
        const path = require('path');
        await bot.telegram.sendDocument(
          payload.telegram_id,
          { source: path.join(__dirname, product.file_url) }
        );
      }
    }

    res.json({ ok: true });
  } catch (e) {
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

// Get sales statistics
app.get('/api/admin/stats', (req, res) => {
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
app.get('/api/admin/purchases', (req, res) => {
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
app.get('/api/admin/users', (req, res) => {
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
// Get user statistics
app.get('/api/admin/user-stats', (req, res) => {
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
app.post('/api/admin/products', (req, res) => {
  try {
    const { name, description, price } = req.body;
    
    console.log('Creating product:', { name, description, price });
    
    const stmt = db.prepare(`
      INSERT INTO products (name, description, price, file_url)
      VALUES (?, ?, ?, NULL)
    `);
    
    const result = stmt.run(name, description, price);
    
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
app.put('/api/admin/products/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price } = req.body;
    
    console.log('Updating product:', { id, name, description, price });
    
    const stmt = db.prepare(`
      UPDATE products 
      SET name = ?, description = ?, price = ?
      WHERE id = ?
    `);
    
    const result = stmt.run(name, description, price, id);
    
    console.log('Product updated, changes:', result.changes);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete product
app.delete('/api/admin/products/:id', (req, res) => {
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
app.post('/api/admin/products/:id/upload', upload.single('file'), (req, res) => {
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