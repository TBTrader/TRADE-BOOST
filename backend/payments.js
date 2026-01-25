const fetch = require('node-fetch');
const db = require('./database');

const CRYPTO_BOT_API = 'https://pay.crypt.bot/api';
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN;

// Создание инвойса для оплаты
async function createInvoice(productId, telegramId) {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      throw new Error('Товар не найден');
    }

    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) {
      throw new Error('Пользователь не найден');
    }

    // Формируем описание с периодом подписки
    const durationDays = product.duration_days || 30;
    let durationText = `${durationDays} дней`;
    if (durationDays === 30) durationText = '1 месяц';
    if (durationDays === 90) durationText = '3 месяца';
    if (durationDays === 365) durationText = '1 год';

    const description = `${product.name} (${durationText})`;

    // Создаём инвойс через прямой HTTP запрос
    const response = await fetch(`${CRYPTO_BOT_API}/createInvoice`, {
      method: 'POST',
      headers: {
        'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: product.price,
        currency_type: 'fiat',
        fiat: 'USD',
        asset: 'USDT',
        description: description,
        paid_btn_name: 'callback',
        paid_btn_url: 'https://tbtrader.github.io/TRADE-BOOST/',
        payload: JSON.stringify({
          product_id: productId,
          user_id: user.id,
          telegram_id: telegramId
        })
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error?.name || 'Ошибка создания инвойса');
    }

    // Сохраняем покупку в БД
    const stmt = db.prepare(`
      INSERT INTO purchases (user_id, product_id, amount, status)
      VALUES (?, ?, ?, 'pending')
    `);
    stmt.run(user.id, productId, product.price);

    return {
      success: true,
      pay_url: data.result.pay_url,
      invoice_id: data.result.invoice_id
    };
  } catch (error) {
    console.error('Ошибка создания инвойса:', error);
    return { success: false, error: error.message };
  }
}

// Обработка webhook от CryptoBot
function handlePaymentUpdate(update) {
  try {
    if (update.status === 'paid') {
      const payload = JSON.parse(update.payload);
      
      const stmt = db.prepare(`
        UPDATE purchases
        SET status = 'paid'
        WHERE id = (
          SELECT id FROM purchases
          WHERE user_id = ? AND product_id = ? AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1
        )
      `);
      stmt.run(payload.user_id, payload.product_id);

      console.log(`✅ Оплата получена: пользователь ${payload.telegram_id}, товар ${payload.product_id}`);
      
      return {
        success: true,
        telegram_id: payload.telegram_id,
        product_id: payload.product_id
      };
    }
    return { success: false };
  } catch (error) {
    console.error('Ошибка обработки платежа:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  createInvoice,
  handlePaymentUpdate
};