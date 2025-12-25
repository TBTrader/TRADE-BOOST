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
  ctx.reply('👋 Привет! Добро пожаловать в магазин трейдинг индикаторов!\n\n' +
    '🔹 /catalog - Посмотреть каталог\n' +
    '🔹 /help - Помощь\n\n' +
    'Скоро здесь откроется полноценный магазин! 🚀');
});

// Команда /catalog
bot.command('catalog', (ctx) => {
  ctx.reply('📊 Наши индикаторы:\n\n' +
    '1️⃣ RSI Pro - 500₽\n' +
    '2️⃣ MACD Advanced - 700₽\n' +
    '3️⃣ Volume Profile - 1000₽\n\n' +
    'Для покупки напишите /buy');
});

// Команда /help
bot.command('help', (ctx) => {
  ctx.reply('ℹ️ Как использовать:\n\n' +
    '/start - Главное меню\n' +
    '/catalog - Каталог товаров\n' +
    '/help - Помощь\n\n' +
    'По всем вопросам: @your_support');
});

// API endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Получение товаров из БД
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products').all();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Создание/получение пользователя
app.post('/api/users', (req, res) => {
  const { telegram_id, username, first_name } = req.body;
  
  try {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO users (telegram_id, username, first_name)
      VALUES (?, ?, ?)
    `);
    insertStmt.run(telegram_id, username, first_name);
    
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// История покупок пользователя
app.get('/api/purchases/:telegram_id', (req, res) => {
  try {
    const purchases = db.prepare(`
      SELECT p.*, pr.name, pr.description, pr.price
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      JOIN products pr ON p.product_id = pr.id
      WHERE u.telegram_id = ? AND p.status = 'paid'
      ORDER BY p.created_at DESC
    `).all(req.params.telegram_id);
    
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Создание инвойса для оплаты
app.post('/api/create-invoice', async (req, res) => {
  const { product_id, telegram_id } = req.body;
  
  try {
    // Создаём или получаем пользователя
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO users (telegram_id, username, first_name)
      VALUES (?, ?, ?)
    `);
    insertStmt.run(telegram_id, req.body.username || '', req.body.first_name || '');
    
    // Создаём инвойс
    const result = await payments.createInvoice(product_id, telegram_id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook для получения уведомлений от CryptoBot
app.post('/api/crypto-webhook', (req, res) => {
  const update = req.body;
  const result = payments.handlePaymentUpdate(update);
  
  if (result.success) {
    // Получаем товар
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.product_id);
    
    // Отправляем пользователю сообщение
    bot.telegram.sendMessage(
      result.telegram_id,
      `✅ Оплата прошла успешно!\n\n` +
      `Вы купили: ${product.name}\n` +
      `Спасибо за покупку! 🎉`
    );
  }
  
  res.json({ ok: true });
});

// Запуск бота
bot.launch();
console.log('🤖 Бот запущен!');

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));