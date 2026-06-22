FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=optional

# --- Development stage: ts-node-dev with respawn (hot reload) ---
# Source is bind-mounted at runtime (see docker-compose.override.yml).
FROM base AS dev
ENV NODE_ENV=development
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "run", "dev"]

# --- Production stage (default) ---
FROM base AS prod

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
