#!/usr/bin/env python3
"""
Бот для Испанских Кварталов с поддержкой дайджестов
"""
import os
import json
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, 
    CommandHandler, 
    MessageHandler, 
    CallbackQueryHandler,
    ContextTypes, 
    filters
)

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

USERS_FILE = 'users.json'

def load_users():
    """Загружает данные пользователей"""
    try:
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {'users': []}

def save_users(data):
    """Сохраняет данные пользователей"""
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_user(tg_id):
    """Получает пользователя по ID"""
    data = load_users()
    for user in data['users']:
        if user['tgId'] == tg_id:
            return user
    return None

def update_user(tg_id, updates):
    """Обновляет данные пользователя"""
    data = load_users()
    user_found = False
    
    for i, user in enumerate(data['users']):
        if user['tgId'] == tg_id:
            data['users'][i].update(updates)
            user_found = True
            break
    
    if not user_found:
        new_user = {'tgId': tg_id}
        new_user.update(updates)
        data['users'].append(new_user)
    
    save_users(data)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start"""
    keyboard = [
        [InlineKeyboardButton("📰 Включить дайджест", callback_data='digest_on')],
        [InlineKeyboardButton("ℹ️ О боте", callback_data='about')]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(
        "🏘 Добро пожаловать в бот Испанских Кварталов!\n\n"
        "Здесь вы можете:\n"
        "• Получать новости района\n"
        "• Подписаться на ежедневный дайджест (21:00)\n"
        "• Просматривать карту бизнеса\n\n"
        "Выберите действие:",
        reply_markup=reply_markup
    )

async def digest_on(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Включает подписку на дайджест"""
    tg_id = update.effective_user.id
    update_user(tg_id, {'digestSubscription': True})
    
    await update.message.reply_text(
        "✅ Вы подписались на ежедневный дайджест!\n\n"
        "📬 Каждый день в 21:00 вы будете получать краткую сводку новостей района.\n\n"
        "Чтобы отписаться, используйте команду /digest_off"
    )

async def digest_off(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Выключает подписку на дайджест"""
    tg_id = update.effective_user.id
    update_user(tg_id, {'digestSubscription': False})
    
    await update.message.reply_text(
        "❌ Вы отписались от ежедневного дайджеста.\n\n"
        "Чтобы снова подписаться, используйте команду /digest_on"
    )

async def digest_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показывает статус подписки"""
    tg_id = update.effective_user.id
    user = get_user(tg_id)
    
    if user and user.get('digestSubscription', False):
        status = "✅ Вы подписаны на ежедневный дайджест"
    else:
        status = "❌ Вы не подписаны на дайджест"
    
    await update.message.reply_text(
        f"{status}\n\n"
        "Команды:\n"
        "/digest_on - Подписаться\n"
        "/digest_off - Отписаться"
    )

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик кнопок"""
    query = update.callback_query
    await query.answer()
    
    if query.data == 'digest_on':
        tg_id = update.effective_user.id
        update_user(tg_id, {'digestSubscription': True})
        await query.edit_message_text(
            "✅ Вы подписались на ежедневный дайджест!\n\n"
            "📬 Каждый день в 21:00 вы будете получать краткую сводку новостей района.\n\n"
            "Чтобы отписаться, используйте команду /digest_off"
        )
    elif query.data == 'about':
        await query.edit_message_text(
            "ℹ️ О боте\n\n"
            "Этот бот создан для жителей ЖК Испанские Кварталы.\n\n"
            "🔗 Веб-приложение: https://ispanskie-msk-bot-ver.vercel.app\n"
            "📱 Telegram: @ispanskie_msk_bot"
        )

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показывает помощь"""
    await update.message.reply_text(
        "📚 Доступные команды:\n\n"
        "/start - Главное меню\n"
        "/digest_on - Подписаться на дайджест\n"
        "/digest_off - Отписаться от дайджеста\n"
        "/digest_status - Статус подписки\n"
        "/help - Эта справка\n\n"
        "🌐 Веб-приложение:\n"
        "https://ispanskie-msk-bot-ver.vercel.app"
    )

def run(token: str):
    """Запускает бота"""
    app = ApplicationBuilder().token(token).build()
    
    # Команды
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("digest_on", digest_on))
    app.add_handler(CommandHandler("digest_off", digest_off))
    app.add_handler(CommandHandler("digest_status", digest_status))
    app.add_handler(CommandHandler("help", help_command))
    
    # Кнопки
    app.add_handler(CallbackQueryHandler(button_handler))
    
    logger.info("Бот запущен!")
    app.run_polling()

if __name__ == '__main__':
    TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
    if not TOKEN:
        logger.error("Не указан TELEGRAM_BOT_TOKEN в переменных окружения")
        exit(1)
    
    run(TOKEN)
