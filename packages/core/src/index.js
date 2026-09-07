/**
 * @spp/core — доменное ядро сквозного проекта «Менеджер задач».
 *
 * Пакет не зависит ни от Express, ни от React: лабораторные работы 1-5
 * подключают одну и ту же бизнес-логику к разным слоям представления.
 */
export * from './errors.js';
export * from './format.js';
export * from './task.js';
export { JsonStore } from './json-store.js';
export { TaskService } from './task-service.js';
