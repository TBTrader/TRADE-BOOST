require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');

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

app.get('/api/products', (req, res) => {
  res.json([
    { id: 1, name: 'RSI Pro', price: 500, description: 'Продвинутый индикатор RSI' },
    { id: 2, name: 'MACD Advanced', price: 700, description: 'Улучшенный MACD' },
    { id: 3, name: 'Volume Profile', price: 1000, description: 'Профиль объёма' }
  ]);
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