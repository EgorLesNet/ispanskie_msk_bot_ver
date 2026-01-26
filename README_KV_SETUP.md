# Vercel KV Setup Guide

## Проблема

Vercel использует read-only файловую систему в serverless функциях. Попытка записать в `db/news.json` приводит к ошибке:

```
Error EROFS: read-only file system, open /var/task/db/news.json
```

## Решение: Vercel KV

Мы переходим на **Vercel KV** — быстрое key-value хранилище от Vercel.

## Настройка

### 1. Создай Vercel KV Database

1. Открой [Vercel Dashboard](https://vercel.com/dashboard)
2. Выбери проект `ispanskie_msk_bot_ver`
3. Перейди в **Storage** → **Create Database**
4. Выбери **KV** (Redis)
5. Назови базу: `ispanskie-db`
6. Нажми **Create**

### 2. Environment Variables

Vercel автоматически добавит переменные:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`
- `KV_URL`

**Важно:** Переменные должны быть доступны для всех environments (Production, Preview, Development).

### 3. Миграция данных

После создания KV базы, перенеси данные из `db.json`:

```bash
# Установи зависимости
npm install

# Запусти миграцию (нужен доступ к KV через env variables)
npm run migrate
```

**Или вручную через Vercel CLI:**

```bash
vercel env pull .env.local
node scripts/migrate-to-kv.js
```

### 4. Деплой

После merge этого PR:

```bash
git pull origin main
vercel --prod
```

## Как это работает

### Старая схема (GitHub API)
```
Бот → GitHub API → db.json (в репозитории)
              ↓
         EROFS Error на Vercel
```

### Новая схема (Vercel KV)
```
Бот → Vercel KV (Redis) ✅
         ↓
   Молниеносно + Без ошибок
```

## API Changes

Код автоматически определяет окружение:

- **На Vercel** → использует Vercel KV
- **Локально** → использует `db.json` (как раньше)

**Никаких изменений в логике бота не требуется!**

## Проверка

После деплоя:

1. Отправь новость боту
2. Проверь сайт — новость должна появиться
3. Проверь логи Vercel — ошибок EROFS быть не должно

```bash
vercel logs --follow
```

## Локальная разработка

Для локальной разработки с KV:

```bash
# Скачай env variables
vercel env pull .env.local

# Запусти сервер
npm start
```

## Откат (если что-то пойдёт не так)

Старый код остаётся в ветке `main`. Чтобы откатить:

```bash
git revert <commit-hash>
vercel --prod
```

База в KV сохранится, можно будет вернуться к ней позже.

---

## FAQ

**Q: Что случится со старым db.json?**  
A: Он останется в репозитории как backup. Новые данные будут в KV.

**Q: Нужно ли менять что-то в коде бота?**  
A: Нет, всё работает автоматически.

**Q: Можно ли использовать другую базу?**  
A: Да, можешь заменить KV на Supabase, Firebase, или PostgreSQL.

**Q: Сколько стоит Vercel KV?**  
A: Hobby план — бесплатно до 256 MB и 10k операций/день.
