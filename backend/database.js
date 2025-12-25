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
  INSERT OR IGNORE INTO products (id, name, description, price, file_url)
  VALUES (?, ?, ?, ?, ?)
`);

insertProduct.run(1, 'RSI Pro', 'Продвинутый индикатор RSI с дополнительными уровнями и сигналами', 500, null);
insertProduct.run(2, 'MACD Advanced', 'Улучшенный MACD с настраиваемыми параметрами', 700, null);
insertProduct.run(3, 'Volume Profile', 'Профессиональный инструмент для анализа объёмов', 1000, null);

console.log('✅ Тестовые товары добавлены');

module.exports = db;