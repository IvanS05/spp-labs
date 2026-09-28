/**
 * Структурированное логирование (пункт 4 задания).
 *
 * Логи пишутся в stdout не текстом, а строками JSON: у каждой записи одни и те же
 * поля (время, уровень, event), поэтому их можно фильтровать и собирать машинно,
 * например `docker compose logs app | grep login_failed`.
 */
import { randomUUID } from 'node:crypto';
import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { app: 'spp-lab3' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Пишет по одной записи на каждый обработанный HTTP-запрос.
 * requestId позволяет связать запись о запросе с записями об ошибках внутри него.
 */
export function requestLogger(req, res, next) {
  req.id = randomUUID();
  const startedAt = Date.now();

  // finish срабатывает, когда ответ полностью ушёл клиенту: только тогда известен код.
  res.on('finish', () => {
    log.info({
      event: 'http_request',
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id ?? null,
      ip: req.ip,
    }, 'запрос обработан');
  });

  next();
}
