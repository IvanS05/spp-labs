/**
 * Наполняет хранилище примерами задач: `npm run seed --workspace @spp/lab1`.
 * Полезно для демонстрации фильтров, сроков и просрочки.
 */
import fs from 'node:fs/promises';
import { TaskService } from '@spp/core';
import config from './config.js';

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const SAMPLES = [
  {
    title: 'Сдать лабораторную №1 по СПП',
    description: 'Список задач с серверным рендерингом: Express + EJS, отправка данных формами.',
    status: 'in_progress',
    priority: 'high',
    dueDate: dayOffset(2),
  },
  {
    title: 'Прочитать документацию по Express 5',
    description: 'Разобраться с изменениями в маршрутизации и обработке ошибок.',
    status: 'todo',
    priority: 'normal',
    dueDate: dayOffset(9),
  },
  {
    title: 'Собрать общее ядро домена для лабораторных 2-5',
    description: 'Пакет @spp/core: модель задачи, валидация, хранилище. Переиспользуется всеми лабораторными.',
    status: 'done',
    priority: 'normal',
    dueDate: dayOffset(-3),
  },
  {
    title: 'Оформить титульный лист отчёта',
    description: 'Без срока — делается в последний момент.',
    status: 'todo',
    priority: 'low',
    dueDate: '',
  },
  {
    title: 'Обновить конспект по HTTP-формам',
    description: 'Разница между application/x-www-form-urlencoded и multipart/form-data.',
    status: 'todo',
    priority: 'high',
    dueDate: dayOffset(-5),
  },
];

await fs.mkdir(config.uploadsDir, { recursive: true });
const service = new TaskService({ file: config.tasksFile });

const existing = await service.all();
if (existing.length > 0 && !process.argv.includes('--force')) {
  console.log(`В хранилище уже ${existing.length} задач. Запустите с --force, чтобы добавить примеры.`);
  process.exit(0);
}

for (const sample of SAMPLES) {
  await service.create(sample);
}

console.log(`Добавлено задач: ${SAMPLES.length}`);
console.log(`Хранилище: ${config.tasksFile}`);
