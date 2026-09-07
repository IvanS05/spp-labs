import { randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';
import { NotFoundError, ValidationError } from './errors.js';
import {
  STATUSES,
  applyTaskUpdate,
  comparators,
  createTask,
  isDueSoon,
  isOverdue,
  isValidStatus,
} from './task.js';

const EMPTY_DB = { version: 1, tasks: [] };

/**
 * Сервис задач: единая точка работы с данными для всех лабораторных.
 * Слой представления (SSR, REST, SPA) не знает, как устроено хранилище.
 */
export class TaskService {
  #store;

  constructor({ file, store } = {}) {
    this.#store = store ?? new JsonStore(file, EMPTY_DB);
  }

  get storageFile() {
    return this.#store.file;
  }

  /** Все задачи в исходном порядке. */
  async all() {
    const db = await this.#store.read();
    return Array.isArray(db.tasks) ? db.tasks : [];
  }

  async getById(id) {
    const tasks = await this.all();
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new NotFoundError(`Задача ${id} не найдена`);
    return task;
  }

  /**
   * Выборка с фильтрацией, поиском и сортировкой.
   * @param {object} query
   * @param {string} [query.status] один из статусов, `overdue` или `all`
   * @param {string} [query.search] подстрока в названии или описании
   * @param {string} [query.sort] ключ сортировки из `comparators`
   */
  async list({ status = 'all', search = '', sort = 'due' } = {}) {
    const tasks = await this.all();
    const needle = String(search).trim().toLowerCase();

    const filtered = tasks.filter((task) => {
      const statusMatch =
        status === 'all' ||
        (status === 'overdue' ? isOverdue(task) : task.status === status);
      if (!statusMatch) return false;
      if (!needle) return true;
      return (
        task.title.toLowerCase().includes(needle) ||
        (task.description ?? '').toLowerCase().includes(needle)
      );
    });

    const compare = comparators[sort] ?? comparators.due;
    return filtered.sort(compare);
  }

  /** Счётчики для вкладок фильтра и карточек статистики. */
  async stats() {
    const tasks = await this.all();
    return {
      all: tasks.length,
      [STATUSES.TODO]: tasks.filter((t) => t.status === STATUSES.TODO).length,
      [STATUSES.IN_PROGRESS]: tasks.filter((t) => t.status === STATUSES.IN_PROGRESS).length,
      [STATUSES.DONE]: tasks.filter((t) => t.status === STATUSES.DONE).length,
      overdue: tasks.filter(isOverdue).length,
      dueSoon: tasks.filter(isDueSoon).length,
      attachments: tasks.reduce((sum, t) => sum + (t.attachments?.length ?? 0), 0),
    };
  }

  async create(input, attachments = []) {
    const task = createTask(input, { id: randomUUID() });
    task.attachments = attachments.map(normalizeAttachment);
    await this.#store.update((db) => {
      db.tasks.push(task);
    });
    return task;
  }

  async update(id, input) {
    return this.#store.update((db) => {
      const index = db.tasks.findIndex((item) => item.id === id);
      if (index === -1) throw new NotFoundError(`Задача ${id} не найдена`);
      const updated = applyTaskUpdate(db.tasks[index], input);
      db.tasks[index] = updated;
      return updated;
    });
  }

  /** Смена только статуса — для быстрых кнопок в списке. */
  async changeStatus(id, status) {
    if (!isValidStatus(status)) {
      throw new ValidationError({ status: 'Неизвестный статус' });
    }
    return this.update(id, { status });
  }

  /** Переключает задачу между «выполнено» и «к выполнению». */
  async toggleDone(id) {
    const task = await this.getById(id);
    const next = task.status === STATUSES.DONE ? STATUSES.TODO : STATUSES.DONE;
    return this.changeStatus(id, next);
  }

  /** Удаляет задачу и возвращает её вместе со списком вложений для очистки файлов. */
  async remove(id) {
    return this.#store.update((db) => {
      const index = db.tasks.findIndex((item) => item.id === id);
      if (index === -1) throw new NotFoundError(`Задача ${id} не найдена`);
      const [removed] = db.tasks.splice(index, 1);
      return removed;
    });
  }

  async addAttachments(id, attachments = []) {
    if (attachments.length === 0) {
      throw new ValidationError({ attachments: 'Выберите хотя бы один файл' });
    }
    return this.#store.update((db) => {
      const task = db.tasks.find((item) => item.id === id);
      if (!task) throw new NotFoundError(`Задача ${id} не найдена`);
      task.attachments.push(...attachments.map(normalizeAttachment));
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  /** Открепляет файл от задачи и возвращает запись вложения. */
  async removeAttachment(taskId, attachmentId) {
    return this.#store.update((db) => {
      const task = db.tasks.find((item) => item.id === taskId);
      if (!task) throw new NotFoundError(`Задача ${taskId} не найдена`);
      const index = task.attachments.findIndex((file) => file.id === attachmentId);
      if (index === -1) throw new NotFoundError('Вложение не найдено');
      const [removed] = task.attachments.splice(index, 1);
      task.updatedAt = new Date().toISOString();
      return removed;
    });
  }
}

function normalizeAttachment(file) {
  return {
    id: file.id ?? randomUUID(),
    originalName: file.originalName,
    storedName: file.storedName,
    size: file.size ?? 0,
    mimeType: file.mimeType ?? 'application/octet-stream',
    uploadedAt: file.uploadedAt ?? new Date().toISOString(),
  };
}
