const Database = require('better-sqlite3');
const db = new Database('shop.db');

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
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
`);

console.log('✅ База данных инициализирована');

// Добавляем тестовые товары
const insertProduct = db.prepare(`
  REPLACE INTO products (id, name, description, price, file_url)
  VALUES (?, ?, ?, ?, ?)
`);

insertProduct.run(
  1,
  'RSI Pro',
  'Advanced RSI indicator with additional levels and signals',
  500,
  'files/rsi_pro.pine'
);

insertProduct.run(
  2,
  'MACD Advanced',
  'Enhanced MACD with customizable parameters',
  700,
  'files/macd_advanced.pine'
);

insertProduct.run(
  3,
  'Volume Profile',
  'Professional tool for volume analysis',
  1000,
  'files/volume_profile.pine'
);
console.log('✅ Тестовые товары добавлены');

module.exports = db;