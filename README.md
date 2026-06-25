---
title: Блокировки — Время разрешения
emoji: 🔒
colorFrom: purple
colorTo: indigo
sdk: docker
pinned: false
---

# Пульс доставки — дашборд процессов доставки

Аналитический дашборд по процессам команд курьеров (очереди Яндекс.Трекера
**POOLING / UDOSTAVKA / DOSTAVKAPIKO** = Курьеры **X / U / R**, и **PUTKURERA**).
FastAPI (один файл `main.py`) + React/Vite/Tailwind, данные — Яндекс.Трекер,
хранилище снапшотов — Turso (SQLite по HTTP), AI — Claude с фолбэком на Mistral.

## Разделы

- **Блокировки** — время разрешения, причины, этапы, AI-сводка.
- **Инциденты** — по месяцам, AI-кластеры причин, стек/приоритет, топы.
- **Арх. комитет** — прохождение и возвраты (АрхКом · ТА), воронка, время цикла.
- **Спринты** — план-факт спринта (Курьеры U): план в SP по ролям + факт из worklog.
- **Анализ SLE** — кластеризация причин нарушений SLE по PUTKURERA.
- **Поток E2E** — WIP Age P90 по Discovery/Delivery, WIP-лимиты.
- **Поток команд** — CFD по статусам + динамика WIP Age по командам (реконструкция из changelog).
- **Оценка НВ** — AI-категория (S/M/L) и effort по эталонам, проверка на MMF, PBR-флоу.
- **ОСП** — обзор сервиса поставки: сделано по месяцам, попадание в SLE.

## Стек и архитектура

- **Бэкенд:** `main.py` (FastAPI). Данные тянутся из Трекера (`tracker_request`/`tracker_query`),
  кэш и история — в Turso (`turso_execute`, таблицы `*_snapshot`, `flow_tasks/flow_transitions`,
  `arch_tasks/arch_transitions`, `sprints/*`). AI — `ai_cached` (Claude→Mistral).
- **Фронтенд:** `frontend/` (React + TS + Vite + Tailwind + recharts). Сборка кладётся в `static/`,
  FastAPI отдаёт SPA. Разделы лениво подгружаются (code-splitting).
- **Деплой:** Docker (см. `Dockerfile`). Бэкенд собирает фронт и поднимает Uvicorn.

## Переменные окружения

Скопируй `.env.example` → `.env` (локально) или задай как секреты окружения. `.env` в `.gitignore`.

| Переменная       | Обязательна | Описание |
|------------------|:-----------:|----------|
| `TRACKER_TOKEN`  | да          | OAuth-токен Яндекс.Трекера (синк и запись полей/комментариев) |
| `ORG_ID`         | да          | X-Org-ID организации (дефолт `7405124`) |
| `TURSO_URL`      | да          | `libsql://<db>.turso.io` (код заменит на `https://`) |
| `TURSO_TOKEN`    | да          | auth-токен Turso |
| `CLAUDE_TOKEN`   | для AI      | ключ Anthropic (или `ANTHROPIC_API_KEY`) |
| `MISTRAL_TOKEN`  | для AI      | ключ Mistral, фолбэк (или `MISTRAL_API_KEY`) |
| `WIP_DISCOVERY` / `WIP_DELIVERY` / `FLOW_TARGET` | нет | лимиты/цель «Поток E2E» |

Без AI-ключей AI-функции просто отключаются, остальное работает.

## Локальный запуск

```bash
# 1) бэкенд
cd hf_app
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install fastapi uvicorn httpx                    # см. импорты main.py
cp .env.example .env                                 # заполни значения
set -a && . ./.env && set +a                         # подгрузить env (bash)
uvicorn main:app --reload --port 7860

# 2) фронтенд (в отдельном терминале, для разработки)
cd hf_app/frontend
npm install
npm run dev        # Vite на :5173, проксирует API на бэкенд
# прод-сборка фронта: npm run build  → static/ отдаётся бэкендом
```

## Docker

```bash
cd hf_app
docker build -t pulse-dashboard .
docker run -p 7860:7860 --env-file .env pulse-dashboard
```

## Данные и синхронизация

- **«Синк»** в шапке — тянет блокировки + историю арх. комитета из Трекера.
- **«Синк потока»** (раздел «Поток команд») — реконструкция CFD/WIP Age из changelog;
  первый полный краул долгий, дальше инкрементально. `?meta=true` — быстрый бэкфилл меты.
- Снапшоты кэшируются в Turso; ежедневный планировщик обновляет ключевые срезы.

## Передача в свой контур

1. Создать пустой репозиторий в вашем GitHub/GitLab.
2. Добавить remote и запушить (см. инструкцию в чате/HANDOFF).
3. Завести секреты окружения (`TRACKER_TOKEN`, `TURSO_*`, AI-ключи) в вашем CI/хостинге.
4. Поднять контейнер по `Dockerfile` (или аналог HF Spaces).

Подробный контекст и история решений — в `PROJECT_CONTEXT.md` и `HANDOFF.md` (в корне проекта).
