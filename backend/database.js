const Database = require('better-sqlite3');
const db = new Database('shop.db');

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    tradingview_username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
    duration_days INTEGER DEFAULT 30,
    tradingview_indicator TEXT,
    file_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    purchase_id INTEGER NOT NULL,
    tradingview_username TEXT NOT NULL,
    start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_date DATETIME NOT NULL,
    status TEXT DEFAULT 'active',
    notified_3days INTEGER DEFAULT 0,
    notified_expired INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (purchase_id) REFERENCES purchases(id)
  );
`);

// Миграция: добавляем новые колонки если их нет
try {
  db.exec(`ALTER TABLE users ADD COLUMN tradingview_username TEXT`);
} catch (e) { /* колонка уже существует */ }

try {
  db.exec(`ALTER TABLE products ADD COLUMN duration_days INTEGER DEFAULT 30`);
} catch (e) { /* колонка уже существует */ }

try {
  db.exec(`ALTER TABLE products ADD COLUMN tradingview_indicator TEXT`);
} catch (e) { /* колонка уже существует */ }

console.log('✅ База данных инициализирована');

// Добавляем тестовые товары с подпиской
const insertProduct = db.prepare(`
  REPLACE INTO products (id, name, description, price, duration_days, tradingview_indicator, file_url)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// RSI Pro - 30 дней
insertProduct.run(
  1,
  'RSI Pro (1 месяц)',
  'Advanced RSI indicator with additional levels and signals. Subscription for 30 days.',
  10,
  30,
  'RSI Pro Indicator',
  null
);

// RSI Pro - 90 дней
insertProduct.run(
  2,
  'RSI Pro (3 месяца)',
  'Advanced RSI indicator with additional levels and signals. Subscription for 90 days. Save 20%!',
  24,
  90,
  'RSI Pro Indicator',
  null
);

// RSI Pro - 365 дней
insertProduct.run(
  3,
  'RSI Pro (1 год)',
  'Advanced RSI indicator with additional levels and signals. Subscription for 1 year. Save 50%!',
  60,
  365,
  'RSI Pro Indicator',
  null
);

console.log('✅ Товары с подпиской добавлены');

module.exports = db;