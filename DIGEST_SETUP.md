# Настройка системы ежедневных дайджестов

## Обзор

Система автоматически генерирует и отправляет ежедневный дайджест новостей всем подписанным пользователям в 21:00 по московскому времени.

## Компоненты

### 1. База данных

- `users.json` - хранит пользователей и их подписки
- `dailyDigest.json` - хранит сгенерированные дайджесты (последние 30 дней)

### 2. Backend (Node.js)

- `lib/digest.js` - генерация дайджестов через OpenAI API
- `lib/users.js` - управление пользователями и подписками
- `api/digest.js` - API endpoint для работы с дайджестами

### 3. Telegram бот (Python)

- `bot_digest.py` - основной бот с командами управления подпиской
- `send_digest.py` - скрипт для отправки дайджестов по расписанию

## Команды бота

- `/start` - Главное меню с кнопками
- `/digest_on` - Подписаться на дайджест
- `/digest_off` - Отписаться от дайджеста
- `/digest_status` - Проверить статус подписки
- `/help` - Справка

## Установка

### 1. Переменные окружения

Добавьте в `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here  # Опционально, для AI-генерации
API_URL=https://your-domain.vercel.app/api/digest
```

### 2. Установка зависимостей

#### Python:
```bash
pip install python-telegram-bot
```

#### Node.js:
```bash
npm install
```

### 3. Запуск бота

```bash
python3 bot_digest.py
```

### 4. Настройка cron для отправки дайджестов

#### Вариант 1: Локальный сервер

```bash
crontab -e
```

Добавьте:
```
0 21 * * * cd /path/to/ispanskie_msk_bot_ver && /usr/bin/python3 send_digest.py >> /var/log/digest.log 2>&1
```

#### Вариант 2: Vercel Cron Jobs

Добавьте в `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/send-digest",
    "schedule": "0 18 * * *"
  }]
}
```

Создайте `api/cron/send-digest.js`:

```javascript
const { getTodayDigest } = require('../../lib/digest');
const { getDigestSubscribers } = require('../../lib/users');

module.exports = async (req, res) => {
  // Проверка секретного ключа для безопасности
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const digest = await getTodayDigest(process.env.OPENAI_API_KEY);
    const subscribers = await getDigestSubscribers();
    
    // Здесь нужно вызвать внешний сервис для отправки через Telegram
    // так как Vercel Serverless Functions не могут запускать длительные процессы
    
    res.json({ success: true, sent: subscribers.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

#### Вариант 3: GitHub Actions

Создайте `.github/workflows/send-digest.yml`:

```yaml
name: Send Daily Digest

on:
  schedule:
    - cron: '0 18 * * *'  # 21:00 MSK = 18:00 UTC
  workflow_dispatch:  # Позволяет запускать вручную

jobs:
  send-digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          pip install python-telegram-bot
      
      - name: Send digest
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          API_URL: ${{ secrets.API_URL }}
        run: |
          python send_digest.py
```

## API Endpoints

### GET /api/digest
Получить дайджест за сегодня (генерируется автоматически при первом запросе)

### GET /api/digest?date=2026-02-03
Получить дайджест за конкретную дату

### POST /api/digest/subscribe
Управление подпиской
```json
{
  "tgId": 123456789,
  "enabled": true
}
```

### GET /api/digest/status?tgId=123456789
Проверить статус подписки

## Генерация дайджестов

Дайджесты генерируются через OpenAI API (GPT-4o-mini) с промптом, оптимизированным для новостей района.

Если API ключ не указан, используется простой текстовый дайджест без AI.

Дайджест генерируется **один раз в день** при первом запросе к `/api/digest` и кешируется в `dailyDigest.json`.

## Мониторинг

- Логи отправки: `/var/log/digest.log`
- Статистика в `dailyDigest.json`: количество новостей, время генерации
- Telegram бот логирует все действия пользователей

## Безопасность

- Секретный ключ для cron endpoints
- API ключ OpenAI хранится в `.env`
- Token бота хранится в `.env`
- `.gitignore` исключает чувствительные файлы

## Troubleshooting

### Дайджесты не отправляются
1. Проверьте cron: `crontab -l`
2. Проверьте логи: `tail -f /var/log/digest.log`
3. Убедитесь, что бот имеет права отправлять сообщения

### Дайджест пустой
1. Проверьте, есть ли новости за сегодня в `db.json`
2. Проверьте статус генерации в `dailyDigest.json`
3. Проверьте API ключ OpenAI

### Пользователи не могут подписаться
1. Проверьте права на запись в `users.json`
2. Проверьте логи бота
3. Убедитесь, что команды работают: `/digest_status`
