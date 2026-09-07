import path from 'node:path';
import { Router } from 'express';
import { ValidationError } from '@spp/core';
import config from '../config.js';
import { asyncRoute, safeReturnTo } from '../lib/http.js';
import {
  deleteStoredFiles,
  discardUploads,
  toAttachmentRecords,
  uploadAttachments,
} from '../middleware/upload.js';

/**
 * Маршруты списка задач. Данные приходят только через отправку форм
 * (POST + multipart/form-data), ответ всегда — готовая HTML-разметка
 * либо редирект по схеме POST/Redirect/GET.
 */
export function createTaskRouter(service) {
  const router = Router();

  /** Общий контекст фильтра: используется списком и ссылками «назад». */
  function readFilter(query) {
    return {
      status: String(query.status ?? 'all'),
      search: String(query.search ?? '').trim(),
      sort: String(query.sort ?? 'due'),
    };
  }

  function listUrl(filter) {
    const params = new URLSearchParams();
    if (filter.status && filter.status !== 'all') params.set('status', filter.status);
    if (filter.search) params.set('search', filter.search);
    if (filter.sort && filter.sort !== 'due') params.set('sort', filter.sort);
    const query = params.toString();
    return query ? `/tasks?${query}` : '/tasks';
  }

  // Список задач с фильтрацией по статусу, поиском и сортировкой.
  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const filter = readFilter(req.query);
      const [tasks, stats] = await Promise.all([service.list(filter), service.stats()]);
      res.render('pages/list', {
        title: null,
        tasks,
        stats,
        filter,
        returnTo: listUrl(filter),
      });
    }),
  );

  // Форма создания задачи.
  router.get('/new', (req, res) => {
    const filter = readFilter(req.query);
    res.render('pages/form', {
      title: 'Новая задача',
      mode: 'create',
      task: emptyTask(),
      errors: {},
      returnTo: listUrl(filter),
    });
  });

  // Создание задачи вместе с прикреплёнными файлами.
  router.post(
    '/',
    uploadAttachments,
    asyncRoute(async (req, res) => {
      const returnTo = safeReturnTo(req.body.returnTo);
      try {
        const task = await service.create(req.body, toAttachmentRecords(req.files));
        res.redirect(`/tasks/${task.id}`);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        await discardUploads(req.files);
        res.status(400).render('pages/form', {
          title: 'Новая задача',
          mode: 'create',
          task: { ...emptyTask(), ...req.body },
          errors: error.fields,
          returnTo,
        });
      }
    }),
  );

  // Карточка задачи со списком вложений.
  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      const task = await service.getById(req.params.id);
      res.render('pages/detail', {
        title: task.title,
        task,
        errors: {},
        returnTo: safeReturnTo(req.query.returnTo),
      });
    }),
  );

  // Форма редактирования.
  router.get(
    '/:id/edit',
    asyncRoute(async (req, res) => {
      const task = await service.getById(req.params.id);
      res.render('pages/form', {
        title: `Редактирование: ${task.title}`,
        mode: 'edit',
        task,
        errors: {},
        returnTo: safeReturnTo(req.query.returnTo, `/tasks/${task.id}`),
      });
    }),
  );

  // Сохранение изменений задачи.
  router.post(
    '/:id',
    uploadAttachments,
    asyncRoute(async (req, res) => {
      const returnTo = safeReturnTo(req.body.returnTo, `/tasks/${req.params.id}`);
      try {
        const task = await service.update(req.params.id, req.body);
        if (req.files?.length) {
          await service.addAttachments(task.id, toAttachmentRecords(req.files));
        }
        res.redirect(`/tasks/${task.id}`);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        await discardUploads(req.files);
        const current = await service.getById(req.params.id);
        res.status(400).render('pages/form', {
          title: `Редактирование: ${current.title}`,
          mode: 'edit',
          task: { ...current, ...req.body },
          errors: error.fields,
          returnTo,
        });
      }
    }),
  );

  // Смена статуса кнопкой прямо из списка.
  router.post(
    '/:id/status',
    asyncRoute(async (req, res) => {
      const returnTo = safeReturnTo(req.body.returnTo);
      await service.changeStatus(req.params.id, String(req.body.status ?? ''));
      res.redirect(returnTo);
    }),
  );

  // Переключение «выполнено / к выполнению» одним чекбоксом-кнопкой.
  router.post(
    '/:id/toggle',
    asyncRoute(async (req, res) => {
      const returnTo = safeReturnTo(req.body.returnTo);
      await service.toggleDone(req.params.id);
      res.redirect(returnTo);
    }),
  );

  // Прикрепление файлов к существующей задаче.
  router.post(
    '/:id/attachments',
    uploadAttachments,
    asyncRoute(async (req, res) => {
      const target = `/tasks/${req.params.id}`;
      try {
        await service.addAttachments(req.params.id, toAttachmentRecords(req.files));
        res.redirect(target);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        await discardUploads(req.files);
        const task = await service.getById(req.params.id);
        res.status(400).render('pages/detail', {
          title: task.title,
          task,
          errors: error.fields,
          returnTo: safeReturnTo(req.body.returnTo),
        });
      }
    }),
  );

  // Скачивание вложения под исходным именем.
  router.get(
    '/:id/attachments/:attachmentId',
    asyncRoute(async (req, res) => {
      const task = await service.getById(req.params.id);
      const file = task.attachments.find((item) => item.id === req.params.attachmentId);
      if (!file) {
        res.status(404).render('pages/error', {
          title: 'Файл не найден',
          status: 404,
          message: 'Такого вложения нет у этой задачи',
        });
        return;
      }
      res.download(path.join(config.uploadsDir, file.storedName), file.originalName);
    }),
  );

  // Открепление файла: сначала запись в базе, затем файл на диске.
  router.post(
    '/:id/attachments/:attachmentId/delete',
    asyncRoute(async (req, res) => {
      const removed = await service.removeAttachment(req.params.id, req.params.attachmentId);
      await deleteStoredFiles([removed]);
      res.redirect(`/tasks/${req.params.id}`);
    }),
  );

  // Удаление задачи вместе со всеми её файлами.
  router.post(
    '/:id/delete',
    asyncRoute(async (req, res) => {
      const returnTo = safeReturnTo(req.body.returnTo);
      const removed = await service.remove(req.params.id);
      await deleteStoredFiles(removed.attachments);
      res.redirect(returnTo);
    }),
  );

  return router;
}

function emptyTask() {
  return {
    id: null,
    title: '',
    description: '',
    status: 'todo',
    priority: 'normal',
    dueDate: '',
    attachments: [],
  };
}
