#!/usr/bin/env python3
"""
Скрипт для отправки ежедневного дайджеста подписчикам
Запускается по расписанию через cron
"""
import os
import sys
import json
import asyncio
import logging
from datetime import datetime
from telegram import Bot

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
        logger.error(f"Файл {USERS_FILE} не найден")
        return {'users': []}

def get_digest():
    """Получает дайджест через API"""
    import urllib.request
    import urllib.error
    
    api_url = os.getenv('API_URL', 'https://ispanskie-msk-bot-ver.vercel.app/api/digest')
    
    try:
        with urllib.request.urlopen(api_url) as response:
            data = json.loads(response.read().decode())
            if data.get('success') and data.get('digest'):
                return data['digest']
    except urllib.error.URLError as e:
        logger.error(f"Ошибка получения дайджеста: {e}")
    
    return None

async def send_digest_to_subscribers(bot_token: str):
    """Отправляет дайджест всем подписчикам"""
    # Загружаем подписчиков
    data = load_users()
    subscribers = [u for u in data['users'] if u.get('digestSubscription', False)]
    
    if not subscribers:
        logger.info("Нет подписчиков на дайджест")
        return
    
    # Получаем дайджест
    digest_data = get_digest()
    
    if not digest_data:
        logger.error("Не удалось получить дайджест")
        return
    
    digest_text = digest_data.get('digest', '')
    posts_count = digest_data.get('postsCount', 0)
    
    if not digest_text:
        logger.warning("Пустой дайджест")
        return
    
    # Инициализируем бота
    bot = Bot(token=bot_token)
    
    # Отправляем дайджест каждому подписчику
    success_count = 0
    error_count = 0
    
    for user in subscribers:
        try:
            tg_id = user['tgId']
            await bot.send_message(
                chat_id=tg_id,
                text=digest_text,
                parse_mode='HTML'
            )
            success_count += 1
            logger.info(f"Дайджест отправлен пользователю {tg_id}")
            
            # Небольшая задержка, чтобы не нарушать лимиты Telegram
            await asyncio.sleep(0.5)
        except Exception as e:
            error_count += 1
            logger.error(f"Ошибка отправки пользователю {user.get('tgId')}: {e}")
    
    logger.info(
        f"Дайджест отправлен: {success_count} успешно, {error_count} ошибок. "
        f"Новостей в дайджесте: {posts_count}"
    )

if __name__ == '__main__':
    TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
    
    if not TOKEN:
        logger.error("Не указан TELEGRAM_BOT_TOKEN в переменных окружения")
        sys.exit(1)
    
    logger.info(f"Запуск отправки дайджеста: {datetime.now()}")
    
    try:
        asyncio.run(send_digest_to_subscribers(TOKEN))
        logger.info("Отправка дайджеста завершена")
    except Exception as e:
        logger.error(f"Критическая ошибка: {e}")
        sys.exit(1)
