require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const db = require('./database');
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));