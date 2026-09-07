import express from 'express';
import multer from 'multer';
import {
  NotFoundError,
  PRIORITY_LIST,
  SORT_LIST,
  STATUSES,
  STATUS_LIST,
  TaskService,
  daysUntilDue,
  formatBytes,
  formatDate,
  formatDateTime,
  formatRelativeDays,
  isDueSoon,
  isOverdue,
  pluralize,
  priorityLabel,
  statusLabel,
  statusTone,
} from '@spp/core';
import config from './config.js';
import { createTaskRouter } from './routes/tasks.js';

/**
 * Собирает приложение лабораторной 1.
 * Сервис задач передаётся снаружи, поэтому приложение легко поднять
 * на отдельном хранилище в тестах.
 */
export function createApp({ service = new TaskService({ file: config.tasksFile }) } = {}) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);
  app.locals.appName = 'Список задач';

  // Хелперы домена доступны во всех шаблонах без импортов в разметке.
  Object.assign(app.locals, {
    STATUSES,
    STATUS_LIST,
    PRIORITY_LIST,
    SORT_LIST,
    statusLabel,
    statusTone,
    priorityLabel,
    isOverdue,
    isDueSoon,
    daysUntilDue,
    formatBytes,
    formatDate,
    formatDateTime,
    formatRelativeDays,
    pluralize,
  });

  // Формы отправляются как application/x-www-form-urlencoded и multipart/form-data.
  app.use(express.urlencoded({ extended: false }));
  app.use('/static', express.static(config.publicDir, { maxAge: '1h' }));

  // Текущий путь нужен шапке, чтобы подсветить активный пункт меню.
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
  });

  app.get('/', (req, res) => res.redirect('/tasks'));
  app.use('/tasks', createTaskRouter(service));

  app.use((req, res) => {
    res.status(404).render('pages/error', {
      title: 'Страница не найдена',
      status: 404,
      message: `Адрес ${req.originalUrl} не существует`,
    });
  });

  app.use((error, req, res, _next) => {
    const status = resolveStatus(error);
    if (status >= 500) console.error(error);
    res.status(status).render('pages/error', {
      title: 'Ошибка',
      status,
      message: describe(error),
    });
  });

  return app;
}

function resolveStatus(error) {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof multer.MulterError) return 400;
  return error.status ?? 500;
}

function describe(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return `Файл больше допустимых ${formatBytes(config.upload.maxFileSize)}`;
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return `За один раз можно прикрепить не больше ${config.upload.maxFiles} файлов`;
    }
    return 'Не удалось загрузить файл';
  }
  if (error.status && error.status < 500) return error.message;
  return 'Внутренняя ошибка сервера. Подробности — в консоли приложения.';
}

export default createApp;
