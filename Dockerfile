# MOVIXA — build the Vite app, then serve the static dist folder.
# Railway injects PORT; the `serve` package reads it automatically (no hardcoded port).
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["npm", "start"]
