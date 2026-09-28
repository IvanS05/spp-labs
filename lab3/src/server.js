/**
 * Лабораторная 3: приложение из лабораторной 2 с разграничением доступа.
 *
 * Здесь только сборка: сервер отдаёт статику из public/, подключает разделы API
 * и разбирает ошибки. Сами разделы лежат рядом:
 *   auth.js   — вход по временным ключам, защита от подбора, восстановление пароля
 *   admin.js  — пользователи и активные подключения (только для администратора)
 *   tasks.js  — задачи с учётом владельца и роли
 *   logger.js — структурированный лог в формате JSON
 *
 * Коды ответов соответствуют семантике HTTP:
 *   200 ok, 201 создано, 202 принято, 204 без тела,
 *   400 неразборный запрос, 401 нет входа, 403 нет прав, 404 нет адреса,
 *   409 конфликт, 410 ссылка устарела, 413 файл велик, 422 неверные данные,
 *   429 слишком часто, 500 ошибка сервера.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import express from 'express';
import multer from 'multer';
import { adminRouter } from './admin.js';
import { authRouter, requireAuth, requireRole } from './auth.js';
import { users } from './db.js';
import { log, requestLogger } from './logger.js';
import { tasksRouter } from './tasks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// Первый администратор не может зарегистрироваться сам (новичкам даётся роль user),
// поэтому при старте создаём его из переменных окружения.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@lab3.local').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

if (!await users.findOne({ email: ADMIN_EMAIL })) {
  await users.insertOne({
    email: ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
    role: 'admin',
    createdAt: new Date(),
  });
  log.info({ event: 'admin_created', email: ADMIN_EMAIL }, 'создана учётная запись администратора');
}

const app = express();

// req.ip должен показывать адрес браузера, а не контейнера, из которого пришёл запрос.
app.set('trust proxy', true);

app.use(requestLogger);

// Без этой строки req.body был бы пустым: Express сам тело JSON-запроса не читает.
app.use(express.json());

// Клиентская часть (index.html, css, js) отдаётся как обычные файлы.
app.use(express.static(path.join(here, '..', 'public')));

// ------------------------------------------------------------------ разделы

app.use('/api/auth', authRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/admin', requireAuth, requireRole('admin'), adminRouter);

// -------------------------------------------------------------------- ошибки

// Сюда попадают запросы к несуществующим адресам API.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Адрес ${req.originalUrl} не существует` });
});

// Обработчик ошибок: Express узнаёт его по четырём аргументам.
app.use((error, req, res, next) => {
  log.error({
    event: 'unhandled_error',
    requestId: req.id,
    url: req.originalUrl,
    message: error.message,
  }, 'ошибка при обработке запроса');

  if (error instanceof multer.MulterError) {
    // 413 — файл больше разрешённого, 422 — с самим набором файлов что-то не так.
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Файл больше 10 МБ' });
    }
    return res.status(422).json({ error: 'Файлов больше пяти или они пришли не в том поле' });
  }
  if (error instanceof SyntaxError) {
    return res.status(400).json({ error: 'Тело запроса не является корректным JSON' });
  }

  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  log.info({ event: 'server_started', port: PORT }, `список задач: http://localhost:${PORT}`);
});
