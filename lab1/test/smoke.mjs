/**
 * Сквозная проверка лабораторной 1: поднимает сервер на временном хранилище
 * и проходит пользовательские сценарии реальными HTTP-запросами.
 *
 * Запуск: npm test --workspace @spp/lab1
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_PORT) || 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spp-lab1-test-'));

const server = spawn(process.execPath, [path.join(here, '..', 'src', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), SPP_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});

// Сервер не должен пережить тест, даже если проверка упала с исключением.
process.on('exit', () => server.kill());

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Сервер не запустился за 15 секунд')), 15_000);
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes(String(PORT))) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.once('error', reject);
});

async function shutdown() {
  server.kill();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

let failures = 0;

function check(name, condition, extra = '') {
  const mark = condition ? 'OK  ' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`${mark} ${name}${extra && !condition ? ' :: ' + extra : ''}`);
}

async function get(path) {
  const res = await fetch(BASE + path, { redirect: 'manual' });
  const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
  return { res, body };
}

async function postForm(path, fields) {
  const form = new URLSearchParams(fields);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'manual',
  });
  return res;
}

async function postMultipart(path, fields, files = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    form.append('attachments', new Blob([file.content], { type: file.type }), file.name);
  }
  const res = await fetch(BASE + path, { method: 'POST', body: form, redirect: 'manual' });
  return res;
}

// 1. Главная страница редиректит на список
{
  const { res } = await get('/');
  check('GET / -> 302 /tasks', res.status === 302 && res.headers.get('location') === '/tasks',
    `${res.status} ${res.headers.get('location')}`);
}

// 2. Список отдаёт готовую разметку
{
  const { res, body } = await get('/tasks');
  check('GET /tasks отдаёт HTML', res.status === 200 && body.includes('<!DOCTYPE html>'), String(res.status));
  check('в разметке есть вкладки фильтра', body.includes('Просроченные'));
}

// 3. Создание задачи с двумя файлами, один с кириллицей в имени
let taskId = null;
{
  const res = await postMultipart(
    '/tasks',
    {
      title: 'Сдать лабораторную №1 по СПП',
      description: 'Express + EJS, рендеринг на сервере',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-09-20',
      returnTo: '/tasks',
    },
    [
      { name: 'отчёт по лабораторной.txt', content: 'содержимое отчёта', type: 'text/plain' },
      { name: 'schema.json', content: '{"ok":true}', type: 'application/json' },
    ],
  );
  const location = res.headers.get('location') ?? '';
  taskId = location.match(/\/tasks\/([\w-]+)/)?.[1] ?? null;
  check('POST /tasks создаёт задачу и редиректит', res.status === 302 && Boolean(taskId),
    `${res.status} ${location}`);
}

// 4. Валидация: пустое название и битая дата возвращают форму с ошибками
{
  const res = await postMultipart('/tasks', { title: '   ', dueDate: '2026-13-45', returnTo: '/tasks' });
  const body = await res.text();
  check('пустое название -> 400 с ошибкой поля',
    res.status === 400 && body.includes('Введите название задачи'), String(res.status));
  check('неверная дата -> ошибка поля даты', body.includes('формате ГГГГ-ММ-ДД'));
}

// 5. Карточка задачи: файлы, кириллица в имени, срок
{
  const { res, body } = await get(`/tasks/${taskId}`);
  check('GET /tasks/:id -> 200', res.status === 200, String(res.status));
  check('вложение с кириллицей в имени сохранено', body.includes('отчёт по лабораторной.txt'));
  check('второе вложение на месте', body.includes('schema.json'));
  check('дата завершения отрендерена', body.includes('сентября 2026'));
  check('приоритет показан', body.includes('Высокий'));
}

// 6. Скачивание вложения отдаёт исходное содержимое
{
  const { body } = await get(`/tasks/${taskId}`);
  const fileId = body.match(new RegExp(`/tasks/${taskId}/attachments/([\\w-]+)"`))?.[1];
  const res = await fetch(`${BASE}/tasks/${taskId}/attachments/${fileId}`);
  const text = await res.text();
  check('скачивание вложения возвращает содержимое', res.status === 200 && text === 'содержимое отчёта',
    `${res.status} ${text}`);
  check('заголовок Content-Disposition с именем файла',
    (res.headers.get('content-disposition') ?? '').includes('filename'));
}

// 7. Фильтрация по статусу
{
  const inProgress = await get('/tasks?status=in_progress');
  check('фильтр «в работе» показывает задачу', inProgress.body.includes('Сдать лабораторную'));
  const done = await get('/tasks?status=done');
  check('фильтр «выполнено» её не показывает', !done.body.includes('Сдать лабораторную'));
}

// 8. Поиск
{
  const found = await get('/tasks?search=' + encodeURIComponent('лаборатор'));
  check('поиск находит задачу', found.body.includes('Сдать лабораторную'));
  const missing = await get('/tasks?search=' + encodeURIComponent('чегототакогонет'));
  check('поиск по несуществующему тексту даёт пустой список', missing.body.includes('Здесь пока пусто'));
}

// 9. Смена статуса формой
{
  const res = await postForm(`/tasks/${taskId}/status`, { status: 'done', returnTo: '/tasks' });
  check('POST status -> редирект на список',
    res.status === 302 && res.headers.get('location').startsWith('/tasks'),
    `${res.status} ${res.headers.get('location')}`);
  const done = await get('/tasks?status=done');
  check('задача попала в «Выполнено»', done.body.includes('Сдать лабораторную'));
}

// 10. Переключение обратно
{
  await postForm(`/tasks/${taskId}/toggle`, { returnTo: '/tasks' });
  const { body } = await get(`/tasks/${taskId}`);
  check('toggle вернул задачу в «К выполнению»', body.includes('К выполнению'));
}

// 11. Просроченная задача попадает в свой фильтр
let overdueId = null;
{
  const res = await postMultipart('/tasks', {
    title: 'Просроченная задача',
    status: 'todo',
    priority: 'normal',
    dueDate: '2020-01-15',
    returnTo: '/tasks',
  });
  overdueId = (res.headers.get('location') ?? '').match(/\/tasks\/([\w-]+)/)?.[1];
  const { body } = await get('/tasks?status=overdue');
  check('просроченная задача в фильтре «Просроченные»', body.includes('Просроченная задача'));
  check('подпись о просрочке отрендерена', body.includes('просрочено на'));
}

// 12. Редактирование
{
  const res = await postMultipart(`/tasks/${taskId}`, {
    title: 'Лабораторная 1 — сдана',
    description: 'обновлённое описание',
    status: 'done',
    priority: 'low',
    dueDate: '',
    returnTo: '/tasks',
  });
  check('POST /tasks/:id сохраняет изменения', res.status === 302, String(res.status));
  const { body } = await get(`/tasks/${taskId}`);
  check('новое название на карточке', body.includes('Лабораторная 1 — сдана'));
  check('срок очищен', body.includes('не задано'));
}

// 13. Добавление файла к существующей задаче и его открепление
{
  const add = await postMultipart(`/tasks/${taskId}/attachments`, {}, [
    { name: 'extra.md', content: '# заметка', type: 'text/markdown' },
  ]);
  check('файл прикреплён к существующей задаче', add.status === 302, String(add.status));

  const empty = await postMultipart(`/tasks/${taskId}/attachments`, {});
  check('отправка без файла -> 400 с сообщением', empty.status === 400, String(empty.status));

  const { body } = await get(`/tasks/${taskId}`);
  const fileId = body.match(/attachments\/([\w-]+)\/delete/)?.[1];
  const del = await postForm(`/tasks/${taskId}/attachments/${fileId}/delete`, {});
  check('открепление файла -> редирект', del.status === 302, String(del.status));
}

// 14. Защита от внешнего редиректа
{
  const res = await postForm(`/tasks/${taskId}/toggle`, { returnTo: 'https://evil.example/x' });
  check('внешний returnTo игнорируется',
    (res.headers.get('location') ?? '').startsWith('/tasks'), res.headers.get('location'));
}

// 15. Экранирование HTML в пользовательском вводе
{
  const res = await postMultipart('/tasks', {
    title: '<script>alert(1)</script>',
    status: 'todo',
    priority: 'normal',
    returnTo: '/tasks',
  });
  const xssId = (res.headers.get('location') ?? '').match(/\/tasks\/([\w-]+)/)?.[1];
  const { body } = await get('/tasks');
  check('теги из ввода экранированы', !body.includes('<script>alert(1)</script>'));
  check('текст показан в экранированном виде', body.includes('&lt;script&gt;'));
  await postForm(`/tasks/${xssId}/delete`, { returnTo: '/tasks' });
}

// 16. Удаление задач
{
  const res = await postForm(`/tasks/${taskId}/delete`, { returnTo: '/tasks' });
  check('POST delete -> редирект', res.status === 302, String(res.status));
  const { res: after } = await get(`/tasks/${taskId}`);
  check('удалённая задача отдаёт 404', after.status === 404, String(after.status));
  await postForm(`/tasks/${overdueId}/delete`, { returnTo: '/tasks' });
}

// 17. Несуществующий адрес
{
  const { res, body } = await get('/nope');
  check('неизвестный адрес -> 404-страница', res.status === 404 && body.includes('не существует'), String(res.status));
}

await shutdown();
console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
