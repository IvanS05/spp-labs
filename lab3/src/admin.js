/**
 * Что может только администратор: смотреть пользователей, менять им роли
 * и закрывать любые активные подключения.
 *
 * Маршруты (префикс /api/admin, все требуют роль admin):
 *   GET    /users            список учётных записей          200
 *   PATCH  /users/:id/role   сменить роль                    200 / 404 / 409 / 422
 *   GET    /sessions         все активные подключения        200
 *   DELETE /sessions/:id     закрыть любое подключение       204 / 404
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { ROLES, publicUser } from './auth.js';
import { sessions, users } from './db.js';
import { log } from './logger.js';

export const adminRouter = express.Router();

adminRouter.get('/users', async (req, res) => {
  const list = await users.find().sort({ createdAt: 1 }).toArray();
  res.json(list.map(publicUser));
});

adminRouter.patch('/users/:id/role', async (req, res) => {
  const role = String(req.body?.role ?? '');
  if (!ROLES.includes(role)) return res.status(422).json({ errors: { role: 'Неизвестная роль' } });
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Пользователь не найден' });

  if (req.params.id === req.user.id) {
    // Иначе администратор может случайно разжаловать сам себя и закрыть себе вход в раздел.
    return res.status(409).json({ error: 'Нельзя менять роль самому себе' });
  }

  const user = await users.findOneAndUpdate(
    { _id: new ObjectId(req.params.id) },
    { $set: { role } },
    { returnDocument: 'after' },
  );
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  log.info({ event: 'role_changed', userId: user._id.toString(), role, by: req.user.id }, 'изменена роль');
  res.json(publicUser(user));
});

adminRouter.get('/sessions', async (req, res) => {
  const list = await sessions.find().sort({ createdAt: -1 }).toArray();
  // Рядом с подключением показываем, чьё оно: один запрос за всеми нужными записями.
  const owners = await users.find({ _id: { $in: list.map((session) => session.userId) } }).toArray();

  res.json(list.map((session) => ({
    id: session._id.toString(),
    email: owners.find((user) => user._id.equals(session.userId))?.email ?? '—',
    ip: session.ip,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    current: session._id.toString() === req.user.sessionId,
  })));
});

adminRouter.delete('/sessions/:id', async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Подключение не найдено' });

  const { deletedCount } = await sessions.deleteOne({ _id: new ObjectId(req.params.id) });
  if (deletedCount === 0) return res.status(404).json({ error: 'Подключение не найдено' });

  log.info({ event: 'session_closed_by_admin', sessionId: req.params.id, by: req.user.id }, 'подключение закрыто администратором');
  res.status(204).end();
});
