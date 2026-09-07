import { ValidationError } from './errors.js';

/** Возможные статусы задачи. Порядок задаёт порядок вкладок фильтра. */
export const STATUSES = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
});

export const STATUS_LIST = Object.freeze([
  { value: STATUSES.TODO, label: 'К выполнению', tone: 'aqua' },
  { value: STATUSES.IN_PROGRESS, label: 'В работе', tone: 'amber' },
  { value: STATUSES.DONE, label: 'Выполнено', tone: 'lime' },
]);

export const PRIORITIES = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
});

export const PRIORITY_LIST = Object.freeze([
  { value: PRIORITIES.LOW, label: 'Низкий' },
  { value: PRIORITIES.NORMAL, label: 'Обычный' },
  { value: PRIORITIES.HIGH, label: 'Высокий' },
]);

const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidStatus(value) {
  return Object.values(STATUSES).includes(value);
}

export function isValidPriority(value) {
  return Object.values(PRIORITIES).includes(value);
}

export function statusLabel(value) {
  return STATUS_LIST.find((s) => s.value === value)?.label ?? value;
}

export function statusTone(value) {
  return STATUS_LIST.find((s) => s.value === value)?.tone ?? 'muted';
}

export function priorityLabel(value) {
  return PRIORITY_LIST.find((p) => p.value === value)?.label ?? value;
}

export function priorityWeight(value) {
  return PRIORITY_WEIGHT[value] ?? 99;
}

/** Начало сегодняшнего дня в локальном времени — база для расчёта просрочки. */
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Разбирает дату формата YYYY-MM-DD как локальную полночь (без сдвига часового пояса). */
export function parseDueDate(value) {
  if (!value || !ISO_DATE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const isReal =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return isReal ? date : null;
}

/**
 * Число дней до срока: 0 — сегодня, отрицательное — просрочено.
 * Возвращает null, если срок не задан.
 */
export function daysUntilDue(dueDate) {
  const parsed = parseDueDate(dueDate);
  if (!parsed) return null;
  const diff = parsed.getTime() - startOfToday().getTime();
  return Math.round(diff / 86_400_000);
}

/** Задача просрочена, если срок в прошлом и она не выполнена. */
export function isOverdue(task) {
  if (task.status === STATUSES.DONE) return false;
  const days = daysUntilDue(task.dueDate);
  return days !== null && days < 0;
}

/** Срок наступает в ближайшие двое суток и задача ещё не выполнена. */
export function isDueSoon(task) {
  if (task.status === STATUSES.DONE) return false;
  const days = daysUntilDue(task.dueDate);
  return days !== null && days >= 0 && days <= 2;
}

/**
 * Проверяет и нормализует данные формы задачи.
 * @throws {ValidationError} если хотя бы одно поле заполнено неверно.
 */
export function validateTaskInput(input = {}) {
  const fields = {};

  const title = String(input.title ?? '').trim();
  if (!title) {
    fields.title = 'Введите название задачи';
  } else if (title.length > TITLE_MAX) {
    fields.title = `Название длиннее ${TITLE_MAX} символов`;
  }

  const description = String(input.description ?? '').trim();
  if (description.length > DESCRIPTION_MAX) {
    fields.description = `Описание длиннее ${DESCRIPTION_MAX} символов`;
  }

  const status = String(input.status ?? STATUSES.TODO).trim();
  if (!isValidStatus(status)) {
    fields.status = 'Неизвестный статус';
  }

  const priority = String(input.priority ?? PRIORITIES.NORMAL).trim();
  if (!isValidPriority(priority)) {
    fields.priority = 'Неизвестный приоритет';
  }

  const rawDue = String(input.dueDate ?? '').trim();
  let dueDate = null;
  if (rawDue) {
    if (!parseDueDate(rawDue)) {
      fields.dueDate = 'Дата должна быть в формате ГГГГ-ММ-ДД';
    } else {
      dueDate = rawDue;
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields);
  }

  return { title, description, status, priority, dueDate };
}

/** Создаёт задачу с системными полями из проверенных данных формы. */
export function createTask(input, { id, now = new Date() } = {}) {
  const data = validateTaskInput(input);
  const timestamp = now.toISOString();
  return {
    id,
    ...data,
    attachments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: data.status === STATUSES.DONE ? timestamp : null,
  };
}

/** Возвращает новый объект задачи с применёнными изменениями. */
export function applyTaskUpdate(task, input, { now = new Date() } = {}) {
  const data = validateTaskInput({ ...task, ...input });
  const timestamp = now.toISOString();
  const becameDone = data.status === STATUSES.DONE && task.status !== STATUSES.DONE;
  const leftDone = data.status !== STATUSES.DONE && task.status === STATUSES.DONE;

  return {
    ...task,
    ...data,
    updatedAt: timestamp,
    completedAt: becameDone ? timestamp : leftDone ? null : task.completedAt,
  };
}

/** Сравнение задач для сортировки. */
export const comparators = {
  due(a, b) {
    const left = parseDueDate(a.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;
    const right = parseDueDate(b.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;
    return left - right || comparators.created(a, b);
  },
  priority(a, b) {
    return priorityWeight(a.priority) - priorityWeight(b.priority) || comparators.due(a, b);
  },
  created(a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  },
  title(a, b) {
    return a.title.localeCompare(b.title, 'ru');
  },
};

export const SORT_LIST = Object.freeze([
  { value: 'due', label: 'По сроку' },
  { value: 'priority', label: 'По приоритету' },
  { value: 'created', label: 'По дате создания' },
  { value: 'title', label: 'По названию' },
]);
