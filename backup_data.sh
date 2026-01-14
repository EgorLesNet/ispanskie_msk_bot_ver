#!/bin/bash

# Auto-backup data files to GitHub
cd /Users/egorlesnykh/ispanskie_msk_bot

# Add data files (forcing add even if in .gitignore)
git add -f db_news.json business.json services.json

# Check if there are changes
if git diff --cached --quiet; then
  echo "Нет изменений для загрузки"
  exit 0
fi

# Commit and push
git commit -m "Auto-backup data: $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main

echo "Данные успешно загружены на GitHub"
