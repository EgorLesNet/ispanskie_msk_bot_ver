# Настройка авторизации через Telegram

## Шаг 1: Настройка Telegram Login Widget

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram

2. Отправьте команду:
   ```
   /setdomain
   ```

3. Выберите вашего бота (@ispanskie_msk_bot)

4. Укажите домен вашего сайта:
   ```
   ispanskie-msk-bot-ver.vercel.app
   ```
   (или ваш кастомный домен)

5. BotFather подтвердит, что домен настроен

## Шаг 2: Обновить profile.html

Откройте `public/profile.html` и замените:

```html
data-telegram-login="YOUR_BOT_USERNAME"
```

На:

```html
data-telegram-login="ispanskie_msk_bot"
```

(или ваш username бота без @)

## Шаг 3: Обновить business.html

Добавьте Telegram Login Widget в business.html на место формы добавления отзыва.

Замените функцию `showAddReviewForm()` на:

```javascript
function showAddReviewForm() {
    const user = JSON.parse(localStorage.getItem('tgUser') || 'null');
    
    if (!user) {
        if (confirm('Для отзывов нужно войти через Telegram. Перейти на страницу профиля?')) {
            window.location.href = 'profile.html';
        }
        return;
    }
    
    document.getElementById('addReviewForm').style.display = 'block';
}
```

И обновите `submitReview()`:

```javascript
async function submitReview() {
    const user = JSON.parse(localStorage.getItem('tgUser') || 'null');
    
    if (!user) {
        alert('Войдите через Telegram');
        window.location.href = 'profile.html';
        return;
    }
    
    const comment = document.getElementById('reviewComment').value.trim();
    
    if (currentRating === 0) {
        alert('Пожалуйста, поставьте оценку');
        return;
    }
    
    const data = {
        businessId: currentBusinessId,
        tgId: user.tgId,
        userName: user.displayName,
        photoUrl: user.photoUrl,
        rating: currentRating,
        comment
    };
    
    try {
        const res = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await res.json();
        
        if (res.ok) {
            alert('Спасибо за отзыв!');
            hideAddReviewForm();
            await loadReviews();
            await loadBusinesses();
        } else {
            alert('Ошибка: ' + (result.error || 'Неизвестная ошибка'));
        }
    } catch (err) {
        alert('Ошибка сети: ' + err.message);
    }
}
```

## Шаг 4: Добавить кнопку Профиль в навигацию

Во всех HTML файлах добавьте в `.nav-inner`:

```html
<a href="profile.html" class="nav-btn">
    <span>👤</span>
    <span class="nav-text">Профиль</span>
</a>
```

## Как это работает

1. **Авторизация**: Пользователь нажимает кнопку "Login with Telegram" на странице профиля

2. **Проверка**: Telegram отправляет данные с HMAC-подписью, которую сервер проверяет через `/api/auth`

3. **Сессия**: Данные пользователя (имя, tgId, фото) сохраняются в localStorage

4. **Отзывы**: При добавлении отзыва API проверяет `tgId` и связывает отзыв с реальным Telegram-аккаунтом

5. **Защита от накрутки**: Один tgId = один отзыв на бизнес

## Что изменилось

### Было:
- Любой мог оставить отзыв с любым именем
- userId создавался случайно в браузере
- Накрутка через инкогнито/новые браузеры

### Стало:
- Отзывы только от авторизованных Telegram-пользователей
- tgId проверяется криптографической подписью
- Накрутка требует создания множества Telegram-аккаунтов (дорого и заметно)
- Пользователь видит свои отзывы в профиле

## Дополнительные возможности

- Можно добавить редактирование своих отзывов
- Удаление отзывов (уже есть DELETE endpoint)
- Фото пользователя рядом с отзывом
- Бейджи "Проверенный сосед" для активных пользователей
