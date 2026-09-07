import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import config from '../config.js';

fs.mkdirSync(config.uploadsDir, { recursive: true });

/**
 * Файлы сохраняются под сгенерированным именем: имя из браузера
 * может содержать разделители пути и повторяться у разных задач.
 * Исходное имя хранится в базе и показывается пользователю.
 */
const storage = multer.diskStorage({
  destination(_req, _file, done) {
    done(null, config.uploadsDir);
  },
  filename(_req, file, done) {
    const extension = path.extname(file.originalname).slice(0, 16);
    done(null, `${randomUUID()}${extension}`);
  },
});

export const uploadAttachments = multer({
  storage,
  limits: {
    fileSize: config.upload.maxFileSize,
    files: config.upload.maxFiles,
  },
}).array('attachments', config.upload.maxFiles);

/**
 * Multer кладёт исходное имя в latin1, поэтому кириллица приезжает битой.
 * Возвращает записи в том виде, в каком их ждёт доменный сервис.
 */
export function toAttachmentRecords(files = []) {
  return files.map((file) => ({
    originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    storedName: file.filename,
    size: file.size,
    mimeType: file.mimetype,
  }));
}

/** Удаляет загруженные файлы, если сохранить задачу не удалось. */
export async function discardUploads(files = []) {
  await Promise.all(
    files.map((file) =>
      fs.promises.rm(path.join(config.uploadsDir, file.filename), { force: true }),
    ),
  );
}

/** Удаляет файлы вложений с диска. */
export async function deleteStoredFiles(attachments = []) {
  await Promise.all(
    attachments.map((file) =>
      fs.promises.rm(path.join(config.uploadsDir, file.storedName), { force: true }),
    ),
  );
}
