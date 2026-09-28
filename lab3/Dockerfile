# Образ приложения. Внутри только Node и наш сервер:
# MongoDB работает отдельной программой, поэтому живёт в своём контейнере.
FROM node:22-alpine

WORKDIR /app

# Зависимости копируем первыми: пока package.json не менялся,
# Docker переиспользует готовый слой и не ставит пакеты заново при каждой сборке.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["node", "src/server.js"]
