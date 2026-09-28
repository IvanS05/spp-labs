/**
 * Подключение к MongoDB и коллекции, которыми пользуется всё приложение.
 *
 * Коллекции:
 *   users    — учётные записи (email, хеш пароля, роль)
 *   sessions — активные подключения: один вход = одна сессия с refresh-ключом
 *   resets   — временные ключи для восстановления пароля по почте
 *   attempts — счётчик неудачных входов (защита от подбора)
 *   tasks    — сами задачи, как в лабораторной 2, но теперь с владельцем
 */
import { MongoClient } from 'mongodb';
import { log } from './logger.js';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';

const client = new MongoClient(MONGO_URL);
await client.connect();

const db = client.db('lab3');

export const users = db.collection('users');
export const sessions = db.collection('sessions');
export const resets = db.collection('resets');
export const attempts = db.collection('attempts');
export const tasks = db.collection('tasks');

// Два почтовых ящика с одним адресом — недоразумение, поэтому запрещаем на уровне базы.
await users.createIndex({ email: 1 }, { unique: true });

// Ключи временные: индекс с expireAfterSeconds: 0 заставляет Mongo самостоятельно
// удалять документы, у которых поле expiresAt оказалось в прошлом.
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
await resets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
await attempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

log.info({ event: 'db_connected', url: MONGO_URL }, 'подключились к MongoDB');
