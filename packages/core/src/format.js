const KB = 1024;
const UNITS = ['Б', 'КБ', 'МБ', 'ГБ'];

/** Человекочитаемый размер файла: 1536 -> «1,5 КБ». */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < KB) return `${value} Б`;
  let size = value;
  let unit = 0;
  while (size >= KB && unit < UNITS.length - 1) {
    size /= KB;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0).replace('.', ',')} ${UNITS[unit]}`;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** «2026-09-05» -> «05 сентября 2026 г.» */
export function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  return dateFormatter.format(new Date(year, month - 1, day));
}

/** ISO-метка времени -> «05.09.2026, 18:30» */
export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateTimeFormatter.format(date);
}

/** Подпись срока относительно сегодняшнего дня. */
export function formatRelativeDays(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  const abs = Math.abs(days);
  const word = pluralize(abs, ['день', 'дня', 'дней']);
  return days > 0 ? `через ${abs} ${word}` : `просрочено на ${abs} ${word}`;
}

/** Русские склонения: 1 задача, 2 задачи, 5 задач. */
export function pluralize(count, forms) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}
