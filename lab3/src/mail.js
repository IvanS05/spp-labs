/**
 * Отправка письма для восстановления доступа (часть пункта 3 задания).
 *
 * Адрес SMTP-сервера берётся из переменных окружения. Если их не задали
 * (обычный случай при проверке на своей машине), письмо не уходит, а ссылка
 * попадает в лог — её видно в `docker compose logs app`.
 */
import nodemailer from 'nodemailer';
import { log } from './logger.js';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
const MAIL_FROM = process.env.MAIL_FROM || 'no-reply@spp-lab3.local';

// Настраиваем реальную отправку только если задан SMTP_HOST. Не задан —
// transport остаётся null, и sendResetLink просто пишет ссылку в лог.
const transport = SMTP_HOST
  ? nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, // порт 465 — сразу зашифрованное соединение
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  })
  : null;

/** Вызывается из auth.js при запросе восстановления пароля (маршрут /forgot). */
export async function sendResetLink(email, link) {
  if (!transport) {
    // SMTP не настроен — обычная ситуация при локальной проверке без своего почтового сервера.
    log.warn({ event: 'mail_skipped', email, link }, 'SMTP не настроен, ссылка только в логе');
    return;
  }

  // Реальная отправка письма через настроенный SMTP-сервер.
  await transport.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: 'Восстановление доступа к списку задач',
    text: `Чтобы задать новый пароль, перейдите по ссылке (она действует 30 минут):\n${link}\n\n`
      + 'Если вы не запрашивали восстановление, просто удалите это письмо.',
  });

  log.info({ event: 'mail_sent', email }, 'письмо с ссылкой восстановления отправлено');
}
