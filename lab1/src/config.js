import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Корень монорепозитория: lab1/src -> lab1 -> корень. */
export const projectRoot = path.resolve(here, '..', '..');

/**
 * Общая для всех лабораторных папка данных.
 * Переопределяется переменной окружения SPP_DATA_DIR.
 */
export const dataDir = process.env.SPP_DATA_DIR
  ? path.resolve(process.env.SPP_DATA_DIR)
  : path.join(projectRoot, 'data');

export const config = {
  port: Number(process.env.PORT) || 3000,
  // null — слушать на всех интерфейсах: «localhost» на Windows резолвится
  // в ::1, и привязка только к нему делает адрес 127.0.0.1 недоступным.
  host: process.env.HOST || null,
  dataDir,
  tasksFile: path.join(dataDir, 'tasks.json'),
  uploadsDir: path.join(dataDir, 'uploads'),
  viewsDir: path.join(here, 'views'),
  publicDir: path.resolve(here, '..', 'public'),
  upload: {
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 5,
  },
};

export default config;
