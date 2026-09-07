import fs from 'node:fs/promises';
import { TaskService } from '@spp/core';
import { createApp } from './app.js';
import config from './config.js';

await fs.mkdir(config.uploadsDir, { recursive: true });

const service = new TaskService({ file: config.tasksFile });
const app = createApp({ service });

const listenArgs = config.host ? [config.port, config.host] : [config.port];

app.listen(...listenArgs, () => {
  console.log('  СПП · Лабораторная 1 — список задач (SSR)');
  console.log(`  http://${config.host ?? 'localhost'}:${config.port}`);
  console.log(`  данные:  ${config.tasksFile}`);
  console.log(`  файлы:   ${config.uploadsDir}`);
});
