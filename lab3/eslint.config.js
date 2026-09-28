/**
 * Настройки ESLint: по ним проверяется код (пункт 5 задания).
 * Локально — командой `npm run lint`, при изменениях — автоматически на GitHub.
 *
 * Серверный и клиентский код живут в разных средах: в первом есть process и Buffer,
 * во втором — document и fetch, поэтому набор известных имён у них разный.
 */
import js from '@eslint/js';
import globals from 'globals';

/** Правила, общие для обеих частей. */
const rules = {
  ...js.configs.recommended.rules,
  // Express узнаёт обработчик ошибок по четырём аргументам, а multer передаёт
  // в свои функции req, который не всегда нужен, — за неиспользуемые аргументы не ругаемся.
  'no-unused-vars': ['error', { args: 'none' }],
  'no-console': 'error', // логи должны идти через logger.js, а не через console.log
  semi: ['error', 'always'], // точка с запятой в конце строки — всегда
  quotes: ['error', 'single'], // строки в коде — в одинарных кавычках
  eqeqeq: ['error', 'always'], // сравнение только через === и !==, а не == и !=
  'prefer-const': 'error',
};

export default [
  { ignores: ['node_modules/**', 'data/**'] },
  {
    files: ['src/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules,
  },
  {
    files: ['public/js/**/*.js'],
    // Скрипт подключён обычным тегом <script>, поэтому sourceType не module.
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: globals.browser },
    rules,
  },
];
