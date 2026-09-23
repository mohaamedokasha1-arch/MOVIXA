# Use the same explicit Node.js 22 runtime for installation and deployment.
FROM node:22-bookworm-slim

WORKDIR /app

# Fail the build if the runtime is wrong or node:sqlite cannot load unflagged.
RUN node -e "console.log('MOVIXA runtime:', process.version); require('node:assert/strict').equal(process.versions.node.split('.')[0], '22'); require('node:sqlite'); console.log('node:sqlite OK')"

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["npm", "start"]
