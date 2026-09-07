/**
 * Ошибка валидации доменных данных.
 * Поле `fields` содержит карту «имя поля -> текст ошибки»,
 * которую слой представления показывает рядом с полями формы.
 */
export class ValidationError extends Error {
  constructor(fields, message = 'Данные формы заполнены неверно') {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
    this.status = 400;
  }
}

/** Запрошенная сущность не найдена. */
export class NotFoundError extends Error {
  constructor(message = 'Запись не найдена') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}
