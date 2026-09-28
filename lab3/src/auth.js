/**
 * Вход в систему на временных ключах (пункты 1 и 3 задания).
 *
 * Ключей два:
 *   access  — JWT на 15 минут, клиент кладёт его в заголовок Authorization.
 *             Сервер ничего не хранит: подпись сама подтверждает, кто пришёл.
 *   refresh — случайная строка на 7 дней, лежит в коллекции sessions.
 *             По нему выдаётся новый access, и именно он делает подключение
 *             «активным»: удалили запись — подключение закрыто.
 *
 * Здесь же защита от подбора пароля и восстановление доступа через почту.
 *
 * Маршруты (префикс /api/auth):
 *   POST   /register           регистрация                       201 / 409 / 422
 *   POST   /login              вход                              200 / 401 / 422 / 429
 *   POST   /refresh            продлить доступ                   200 / 401
 *   POST   /logout             закрыть своё подключение          204
 *   GET    /me                 кто я                             200 / 401
 *   GET    /sessions           свои активные подключения         200 / 401
 *   DELETE /sessions/:id       закрыть подключение               204 / 401 / 404
 *   POST   /forgot             письмо со ссылкой на смену пароля 202 / 422
 *   POST   /reset              задать новый пароль по ссылке     204 / 410 / 422
 */
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { attempts, resets, sessions, users } from './db.js';
import { log } from './logger.js';
import { sendResetLink } from './mail.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const ACCESS_TTL = '15m'; // срок жизни ключа доступа
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // срок жизни ключа обновления
const RESET_TTL_MS = 30 * 60 * 1000; // срок жизни ссылки из письма
const MAX_SESSIONS = 3; // сколько одновременных подключений разрешено одному пользователю
const MAX_FAILS = 5; // после стольких промахов подряд вход блокируется
const LOCK_MS = 15 * 60 * 1000; // на столько блокируется вход

/** Три роли из задания. Порядок — от меньших прав к большим. */
export const ROLES = ['user', 'manager', 'admin'];

/** В базе лежат не сами ключи, а их отпечатки: из базы ключ восстановить нельзя. */
const fingerprint = (token) => createHash('sha256').update(token).digest('hex');

/** Учётная запись -> то, что можно показать клиенту (без хеша пароля). */
export function publicUser(user) {
  return { id: user._id.toString(), email: user.email, role: user.role };
}

/**
 * Ключ доступа. Внутри только кто пришёл и по какому подключению:
 * почту и роль сервер берёт из базы, иначе смена роли не действовала бы,
 * пока у человека на руках старый ключ.
 */
function signAccessKey(user, sessionId) {
  const payload = {
    sub: user._id.toString(),
    sid: sessionId.toString(), // по нему проверяем, что подключение ещё не закрыли
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

/** Открывает новое подключение и выдаёт пару ключей. */
async function openSession(user, req) {
  const refreshToken = randomBytes(32).toString('hex');
  const now = new Date();

  const { insertedId } = await sessions.insertOne({
    userId: user._id,
    tokenFingerprint: fingerprint(refreshToken),
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  });

  // Контроль активных подключений: держим не больше MAX_SESSIONS, лишнее старое закрываем.
  const open = await sessions.find({ userId: user._id }).sort({ createdAt: -1 }).toArray();
  for (const extra of open.slice(MAX_SESSIONS)) {
    await sessions.deleteOne({ _id: extra._id });
    log.info({
      event: 'session_evicted',
      userId: user._id.toString(),
      sessionId: extra._id.toString(),
    }, 'закрыто самое старое подключение');
  }

  return { accessToken: signAccessKey(user, insertedId), refreshToken };
}

/** Проверка данных регистрации и смены пароля. */
function checkCredentials(body) {
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');

  const errors = {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Введите корректный адрес почты';
  if (password.length < 8) errors.password = 'Пароль короче 8 символов';

  return { errors, email, password };
}

// --------------------------------------------------- проверка прав на маршруте

/**
 * Пускает дальше только с действующим ключом доступа.
 * 401 — ключа нет, он испорчен, истёк или подключение уже закрыли.
 */
export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Заголовок WWW-Authenticate у ответа 401 требует стандарт HTTP.
  res.set('WWW-Authenticate', 'Bearer');

  if (!token) return res.status(401).json({ error: 'Требуется вход в систему' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';
    // Поле expired подсказывает клиенту, что стоит попробовать продлить доступ.
    return res.status(401).json({
      error: expired ? 'Срок действия ключа доступа истёк' : 'Ключ доступа недействителен',
      expired,
    });
  }

  // Ключ подписан нами, но подключение могли закрыть раньше срока — проверяем сессию.
  const session = await sessions.findOne({ _id: new ObjectId(payload.sid) });
  if (!session) return res.status(401).json({ error: 'Подключение закрыто, войдите заново' });

  // Роль берём из базы на каждом запросе: если администратор её только что
  // изменил, новые права действуют сразу, а не после перезахода.
  const user = await users.findOne({ _id: session.userId });
  if (!user) return res.status(401).json({ error: 'Учётная запись удалена' });

  await sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  req.user = { id: user._id.toString(), email: user.email, role: user.role, sessionId: payload.sid };
  next();
}

/** Пускает дальше только перечисленные роли. 403 — вошёл, но прав не хватает. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();

    log.warn({
      event: 'access_denied',
      requestId: req.id,
      userId: req.user.id,
      role: req.user.role,
      url: req.originalUrl,
    }, 'доступ запрещён');
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
  };
}

// ------------------------------------------------------------------ маршруты

export const authRouter = express.Router();

// Регистрация. Новичку всегда достаётся роль user, повысить может только администратор.
authRouter.post('/register', async (req, res) => {
  const { errors, email, password } = checkCredentials(req.body);
  if (Object.keys(errors).length > 0) return res.status(422).json({ errors });

  if (await users.findOne({ email })) {
    // 409 Conflict — запрос правильный, но противоречит тому, что уже есть на сервере.
    return res.status(409).json({ error: 'Такой адрес почты уже зарегистрирован' });
  }

  const user = {
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'user',
    createdAt: new Date(),
  };
  const { insertedId } = await users.insertOne(user);

  log.info({ event: 'user_registered', userId: insertedId.toString(), email }, 'создана учётная запись');
  res.status(201).json(publicUser({ ...user, _id: insertedId }));
});

// Вход. Пять промахов подряд — и адрес блокируется на 15 минут.
authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const lock = await attempts.findOne({ _id: email }); // lock - запись о блокировке входа для данного email
  if (lock?.lockedUntil > new Date()) {
    const seconds = Math.ceil((lock.lockedUntil - Date.now()) / 1000);
    log.warn({ event: 'login_blocked', email, ip: req.ip }, 'вход заблокирован после подбора');
    // 429 Too Many Requests + Retry-After: стандартный способ сказать «приходи позже».
    return res.set('Retry-After', String(seconds)).status(429).json({
      error: `Слишком много неудачных попыток. Повторите через ${Math.ceil(seconds / 60)} мин`,
    });
  }

  const user = await users.findOne({ email });
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    await countFailure(email, req);
    return res.status(401).json({ error: 'Неверный адрес почты или пароль' });
  }

  await attempts.deleteOne({ _id: email }); // удачный вход обнуляет счётчик промахов
  const keys = await openSession(user, req);

  log.info({ event: 'login_succeeded', userId: user._id.toString(), email, ip: req.ip }, 'выполнен вход');
  res.json({ ...keys, user: publicUser(user) });
});

/** Считает неудачные попытки входа и блокирует адрес, когда их стало слишком много. */
async function countFailure(email, req) {
  const record = await attempts.findOneAndUpdate(
    { _id: email },
    { $inc: { fails: 1 }, $set: { expiresAt: new Date(Date.now() + LOCK_MS) } },
    { upsert: true, returnDocument: 'after' },
  );

  if (record.fails >= MAX_FAILS) {
    await attempts.updateOne({ _id: email }, { $set: { fails: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } });
  }

  log.warn({ event: 'login_failed', email, ip: req.ip, fails: record.fails }, 'неудачная попытка входа');
}

// Продление доступа. Ключ обновления меняется на новый: перехваченный старый бесполезен.
authRouter.post('/refresh', async (req, res) => {
  const token = String(req.body?.refreshToken ?? '');
  const session = await sessions.findOne({ tokenFingerprint: fingerprint(token) });

  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Ключ обновления недействителен, войдите заново' });
  }

  const user = await users.findOne({ _id: session.userId });
  if (!user) {
    await sessions.deleteOne({ _id: session._id });
    return res.status(401).json({ error: 'Учётная запись удалена' });
  }

  const refreshToken = randomBytes(32).toString('hex');
  await sessions.updateOne({ _id: session._id }, {
    $set: {
      tokenFingerprint: fingerprint(refreshToken),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });

  log.info({
    event: 'token_refreshed',
    userId: user._id.toString(),
    sessionId: session._id.toString(),
  }, 'выдан новый ключ доступа');
  res.json({ accessToken: signAccessKey(user, session._id), refreshToken, user: publicUser(user) });
});

// Выход: подключение закрывается, ключ обновления перестаёт работать.
authRouter.post('/logout', async (req, res) => {
  const token = String(req.body?.refreshToken ?? '');
  const { deletedCount } = await sessions.deleteOne({ tokenFingerprint: fingerprint(token) });

  log.info({ event: 'logout', closed: deletedCount }, 'подключение закрыто');
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await users.findOne({ _id: new ObjectId(req.user.id) });
  if (!user) return res.status(404).json({ error: 'Учётная запись не найдена' });

  res.json(publicUser(user));
});

// Список своих активных подключений: откуда и когда входили.
authRouter.get('/sessions', requireAuth, async (req, res) => {
  const list = await sessions.find({ userId: new ObjectId(req.user.id) }).sort({ createdAt: -1 }).toArray();

  res.json(list.map((session) => ({
    id: session._id.toString(),
    ip: session.ip,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    current: session._id.toString() === req.user.sessionId,
  })));
});

// Закрыть одно из своих подключений (например, забытый вход с чужого компьютера).
authRouter.delete('/sessions/:id', requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Подключение не найдено' });

  const { deletedCount } = await sessions.deleteOne({
    _id: new ObjectId(req.params.id),
    userId: new ObjectId(req.user.id), // чужое подключение закрыть нельзя
  });
  if (deletedCount === 0) return res.status(404).json({ error: 'Подключение не найдено' });

  log.info({
    event: 'session_closed',
    userId: req.user.id,
    sessionId: req.params.id,
  }, 'пользователь закрыл подключение');
  res.status(204).end();
});

// Запрос письма со ссылкой на смену пароля.
authRouter.post('/forgot', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email) return res.status(422).json({ errors: { email: 'Введите адрес почты' } });

  const user = await users.findOne({ email });
  if (user) {
    // Токен для ссылки — обычный случайный набор байт, как refresh-ключ.
    const token = randomBytes(32).toString('hex');
    // В базу кладём не сам токен, а его отпечаток (см. fingerprint выше):
    // если базу украдут, восстановить из неё рабочие ссылки будет нельзя.
    await resets.insertOne({
      tokenFingerprint: fingerprint(token),
      userId: user._id,
      expiresAt: new Date(Date.now() + RESET_TTL_MS), // ссылка живёт 30 минут
    });
    // А вот в письмо уходит настоящий токен — по хешу проверить ссылку нельзя.
    await sendResetLink(email, `${APP_URL}/?reset=${token}`);
  }

  log.info({ event: 'reset_requested', email, found: Boolean(user) }, 'запрошено восстановление доступа');
  // Ответ одинаковый для существующего и несуществующего адреса: иначе форма
  // превращается в способ узнать, кто зарегистрирован. 202 — «приняли, делаем».
  res.status(202).json({ message: 'Если такой адрес зарегистрирован, письмо со ссылкой отправлено' });
});

// Смена пароля по ссылке из письма.
authRouter.post('/reset', async (req, res) => {
  const token = String(req.body?.token ?? '');
  const password = String(req.body?.password ?? '');
  if (password.length < 8) return res.status(422).json({ errors: { password: 'Пароль короче 8 символов' } });

  // Ищем ссылку по отпечатку токена из адреса — так же, как сессию по refresh-ключу.
  const record = await resets.findOne({ tokenFingerprint: fingerprint(token) });
  if (!record || record.expiresAt < new Date()) {
    // 410 Gone — ссылка была настоящей, но уже использована или просрочена.
    return res.status(410).json({ error: 'Ссылка недействительна или устарела' });
  }

  // Новый пароль хешируем точно так же, как при регистрации, — в базе всегда только хеш.
  await users.updateOne({ _id: record.userId }, { $set: { passwordHash: await bcrypt.hash(password, 10) } });
  // Ссылка одноразовая: использованную (и заодно все другие, если их запрашивали) удаляем.
  await resets.deleteMany({ userId: record.userId });
  // Пароль сменили — все прежние подключения закрываем, даже если их открыл злоумышленник.
  const { deletedCount } = await sessions.deleteMany({ userId: record.userId });

  log.info({
    event: 'password_reset',
    userId: record.userId.toString(),
    closedSessions: deletedCount,
  }, 'пароль изменён по ссылке из письма');
  res.status(204).end();
});
