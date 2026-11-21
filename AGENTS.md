# y-report backend

Репозиторий сервера. Клиент — соседняя папка `../frontend` со своим git. Общие факты, порядок работы и границы — в `../AGENTS.md`.

## Стек

- Node.js 24, TypeScript, Hono, Zod, Drizzle ORM, PostgreSQL, Better Auth
- pnpm
- Имена в коде: английские

## Код

- `src/index.ts` — вход
- `src/app.ts` — приложение Hono
- `src/routes/` — маршруты областей
- `src/db/` — схема Drizzle и клиент PostgreSQL
- `src/auth/` — Better Auth
- `drizzle.config.ts` — конфиг миграций

Области: `team`, `schedule`, `shift-report`.

## API

JSON REST, префикс `/api`. Контракт с клиентом — HTTP и Zod. Общий пакет типов не заводить.

`DATABASE_URL` лежит в `.env`. Этот файл не коммитить.

Аутентификация: Better Auth, сессии. Роли и права не зафиксированы — не добавлять, пока они не записаны в `../AGENTS.md`.

## Тесты

Vitest. Файлы `*.test.ts` лежат рядом с кодом.

## Клиент

Меняешь маршрут или форму ответа — в том же плане меняется вызов в `../frontend`. Сначала прочитай `../frontend/AGENTS.md`.
