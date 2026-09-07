import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Простое файловое JSON-хранилище с атомарной записью и очередью операций.
 *
 * Запись идёт во временный файл и завершается rename, поэтому прерванный
 * процесс не оставляет повреждённый JSON. Все операции выстраиваются в
 * цепочку промисов, что исключает гонки при параллельных запросах.
 */
export class JsonStore {
  #file;
  #fallback;
  #queue = Promise.resolve();

  constructor(file, fallback = {}) {
    this.#file = file;
    this.#fallback = fallback;
  }

  get file() {
    return this.#file;
  }

  async read() {
    try {
      const raw = await fs.readFile(this.#file, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(this.#fallback);
      throw error;
    }
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.#file);
    return data;
  }

  /**
   * Читает данные, передаёт их в `mutator` и сохраняет результат.
   * Операции сериализуются, поэтому конкурентные вызовы безопасны.
   * @returns результат, который вернул `mutator` (по умолчанию — данные).
   */
  update(mutator) {
    const run = async () => {
      const data = await this.read();
      const result = await mutator(data);
      await this.write(data);
      return result === undefined ? data : result;
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => {});
    return next;
  }
}
