const CryptoBotAPI = require('crypto-bot-api');
const db = require('./database');

// Инициализация CryptoBot API
const cryptoBot = new CryptoBotAPI(process.env.CRYPTO_BOT_TOKEN);

// Создание инвойса для оплаты
async function createInvoice(productId, telegramId) {
  try {
    // Получаем товар из БД
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      throw new Error('Товар не найден');
    }

    // Получаем пользователя
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) {
      throw new Error('Пользователь не найден');
    }

    // Создаём инвойс в CryptoBot
    const invoice = await cryptoBot.createInvoice({
      amount: product.price,
      currency_type: 'fiat',
      fiat: 'RUB',
      asset: 'USDT',
      description: product.name,
      paid_btn_name: 'callback',
      paid_btn_url: 'https://t.me/your_bot',
      payload: JSON.stringify({
        product_id: productId,
        user_id: user.id,
        telegram_id: telegramId
      })
    });

    // Сохраняем покупку в БД со статусом pending
    const stmt = db.prepare(`
      INSERT INTO purchases (user_id, product_id, amount, status)
      VALUES (?, ?, ?, 'pending')
    `);
    stmt.run(user.id, productId, product.price);

    return {
      success: true,
      pay_url: invoice.pay_url,
      invoice_id: invoice.invoice_id
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
      
      // Обновляем статус покупки
      const stmt = db.prepare(`
        UPDATE purchases 
        SET status = 'paid' 
        WHERE user_id = ? AND product_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
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