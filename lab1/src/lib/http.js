/**
 * Разрешает редирект только на внутренние адреса.
 * Пришедший из формы `returnTo` — это пользовательский ввод, поэтому
 * внешние ссылки и протокольно-относительные «//host» отбрасываются.
 */
export function safeReturnTo(value, fallback = '/tasks') {
  const raw = String(value ?? '').trim();
  if (raw.length === 0 || raw[0] !== '/') return fallback;
  // 92 — код обратного слеша: «/\host» некоторые браузеры считают внешним адресом.
  if (raw[1] === '/' || raw.charCodeAt(1) === 92) return fallback;
  return raw;
}

/** Оборачивает асинхронный обработчик, передавая отказ промиса в next(). */
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
