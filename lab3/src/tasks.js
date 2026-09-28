/**
 * Задачи из лабораторной 2, но теперь у каждой есть владелец и права проверяются.
 *
 * Кто что может:
 *   user    — видит и меняет только свои задачи, удаляет тоже только свои
 *   manager — видит и меняет все задачи, удаляет только свои
 *   admin   — видит, меняет и удаляет любые задачи
 *
 * Маршруты (префикс /api/tasks, все требуют вход):
 *   GET    /                          список задач                  200
 *   GET    /:id                       одна задача                   200 / 403 / 404
 *   POST   /                          создать задачу                201 / 422
 *   PUT    /:id                       изменить задачу               200 / 403 / 404 / 422
 *   PATCH  /:id/status                сменить только статус         200 / 403 / 404 / 422
 *   DELETE /:id                       удалить задачу                204 / 403 / 404
 *   POST   /:id/attachments           загрузить файлы               201 / 403 / 404 / 413 / 422
 *   GET    /:id/attachments/:fileId   скачать файл                  200 / 403 / 404
 *   DELETE /:id/attachments/:fileId   удалить файл                  204 / 403 / 404
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { tasks } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(here, '..', 'data', 'uploads');

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'normal', 'high'];

await fs.mkdir(UPLOADS_DIR, { recursive: true });

/** Документ из Mongo -> объект для клиента: ObjectId превращаем в строку id. */
function toJson(task) {
  const { _id, ...fields } = task;
  return { id: _id.toString(), ...fields };
}

/** Ищет задачу по id из адреса. Некорректный id — та же ситуация, что и «не найдено». */
async function findTask(id) {
  if (!ObjectId.isValid(id)) return null;
  return tasks.findOne({ _id: new ObjectId(id) });
}

/** Смотреть и менять чужие задачи может только менеджер или администратор. */
function canUse(task, user) {
  return user.role !== 'user' || task.ownerId === user.id;
}

/** Удалять чужие задачи может только администратор. */
function canDelete(task, user) {
  return user.role === 'admin' || task.ownerId === user.id;
}

/**
 * Достаёт задачу и сразу проверяет права. Если чего-то не хватает, сам отвечает
 * клиенту и возвращает null — маршруту останется только выйти.
 */
async function loadTask(req, res, check = canUse) {
  const task = await findTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Задача не найдена' });
    return null;
  }
  if (!check(task, req.user)) {
    res.status(403).json({ error: 'Эта задача принадлежит другому пользователю' });
    return null;
  }
  return task;
}

/**
 * Проверка данных задачи, пришедших от клиента.
 * Возвращает ошибки по полям и очищенные значения — доверять клиенту нельзя.
 */
function validate(body) {
  const title = String(body?.title ?? '').trim();
  const description = String(body?.description ?? '').trim();
  const status = String(body?.status ?? 'todo').trim();
  const priority = String(body?.priority ?? 'normal').trim();
  const dueDate = String(body?.dueDate ?? '').trim();

  const errors = {};
  if (!title) errors.title = 'Введите название задачи';
  else if (title.length > 120) errors.title = 'Название длиннее 120 символов';
  if (description.length > 2000) errors.description = 'Описание длиннее 2000 символов';
  if (!STATUSES.includes(status)) errors.status = 'Неизвестный статус';
  if (!PRIORITIES.includes(priority)) errors.priority = 'Неизвестный приоритет';
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    errors.dueDate = 'Дата должна быть в формате ГГГГ-ММ-ДД';
  }

  return { errors, data: { title, description, status, priority, dueDate } };
}

const now = () => new Date().toISOString();

// ------------------------------------------------------------ загрузка файлов

// Файлы кладём на диск под случайным именем: имена из браузера могут совпасть.
// Настоящее имя храним в документе задачи и показываем пользователю.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, done) => done(null, UPLOADS_DIR),
    filename: (req, file, done) => done(null, randomUUID() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
}).array('attachments', 5);

/** Файлы от multer -> записи, которые лягут в поле attachments задачи. */
function toAttachments(files = []) {
  return files.map((file) => ({
    id: randomUUID(),
    // multer отдаёт имя в latin1, без перекодировки кириллица превращается в кракозябры.
    originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    storedName: file.filename,
    size: file.size,
    uploadedAt: now(),
  }));
}

/** Удаляет файлы вложений с диска. */
async function deleteFiles(attachments) {
  for (const file of attachments) {
    await fs.rm(path.join(UPLOADS_DIR, file.storedName), { force: true });
  }
}

// ------------------------------------------------------------------ маршруты

export const tasksRouter = express.Router();

// Список задач: обычный пользователь видит только свои, остальные — все.
tasksRouter.get('/', async (req, res) => {
  const filter = req.user.role === 'user' ? { ownerId: req.user.id } : {};// для user «только задачи, где владелец — я», Роль manager или admin пустой объект, условий нет, значит без фильтра
  const list = await tasks.find(filter).sort({ createdAt: -1 }).toArray();

  res.json(list.map(toJson));
});

// Одна задача.
tasksRouter.get('/:id', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  res.json(toJson(task));
});

// Создание задачи. 201 — «создано», в ответе лежит сама задача вместе с новым id.
tasksRouter.post('/', async (req, res) => {
  const { errors, data } = validate(req.body);
  // 422 — тело запроса разобрано, но значения в нём не годятся.
  if (Object.keys(errors).length > 0) return res.status(422).json({ errors });

  const task = {
    ...data,
    ownerId: req.user.id,
    ownerEmail: req.user.email,
    attachments: [],
    createdAt: now(),
    updatedAt: now(),
  };
  const { insertedId } = await tasks.insertOne(task);

  res.status(201).json(toJson({ ...task, _id: insertedId }));
});

// Изменение задачи: клиент присылает все поля целиком, поэтому PUT.
tasksRouter.put('/:id', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const { errors, data } = validate(req.body);
  if (Object.keys(errors).length > 0) return res.status(422).json({ errors });

  const updatedAt = now();
  await tasks.updateOne({ _id: task._id }, { $set: { ...data, updatedAt } });

  res.json(toJson({ ...task, ...data, updatedAt }));
});

// Смена статуса меняет одно поле, а не всю задачу, — это PATCH.
tasksRouter.patch('/:id/status', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const status = String(req.body?.status ?? '').trim();
  if (!STATUSES.includes(status)) {
    return res.status(422).json({ errors: { status: 'Неизвестный статус' } });
  }

  const updatedAt = now();
  await tasks.updateOne({ _id: task._id }, { $set: { status, updatedAt } });

  res.json(toJson({ ...task, status, updatedAt }));
});

// Удаление задачи вместе с её файлами. 204 — «успешно, отвечать нечем».
tasksRouter.delete('/:id', async (req, res) => {
  const task = await loadTask(req, res, canDelete);
  if (!task) return;

  await tasks.deleteOne({ _id: task._id });
  await deleteFiles(task.attachments);

  res.status(204).end();
});

// Загрузка файлов к существующей задаче: тело запроса — multipart/form-data.
tasksRouter.post('/:id/attachments', upload, async (req, res) => {
  const attachments = toAttachments(req.files);

  const task = await loadTask(req, res);
  if (!task) {
    // Задача не наша или её нет — принятые файлы уже не к чему прикреплять.
    await deleteFiles(attachments);
    return;
  }

  if (attachments.length === 0) {
    return res.status(422).json({ errors: { attachments: 'Выберите хотя бы один файл' } });
  }

  const updatedAt = now();
  await tasks.updateOne(
    { _id: task._id },
    { $push: { attachments: { $each: attachments } }, $set: { updatedAt } },
  );

  res.status(201).json(toJson({ ...task, attachments: [...task.attachments, ...attachments], updatedAt }));
});

// Скачивание файла под тем именем, которое видел пользователь.
tasksRouter.get('/:id/attachments/:fileId', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const file = task.attachments.find((item) => item.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Вложение не найдено' });

  res.download(path.join(UPLOADS_DIR, file.storedName), file.originalName);
});

// Удаление одного вложения: сначала запись в базе, потом файл с диска.
tasksRouter.delete('/:id/attachments/:fileId', async (req, res) => {
  const task = await loadTask(req, res);
  if (!task) return;

  const file = task.attachments.find((item) => item.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Вложение не найдено' });

  await tasks.updateOne(
    { _id: task._id },
    { $pull: { attachments: { id: file.id } }, $set: { updatedAt: now() } },
  );
  await deleteFiles([file]);

  res.status(204).end();
});
