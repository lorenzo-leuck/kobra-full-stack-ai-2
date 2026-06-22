FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install

# --- Development stage: Vite dev server with hot-module reload ---
# Source is bind-mounted at runtime (see docker-compose.override.yml).
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

# --- Production stage (default) ---
FROM base AS prod

# Copy the rest of the app
COPY . .

# Backend URLs are baked into the static build (the browser calls these directly).
# Override via docker-compose build args if your hosts/ports differ.
ARG VITE_AGENT_API_BASE=http://localhost:8000
ARG VITE_MARKET_API_BASE=http://localhost:3001
ENV VITE_AGENT_API_BASE=$VITE_AGENT_API_BASE \
    VITE_MARKET_API_BASE=$VITE_MARKET_API_BASE

# Build for production (Vite)
RUN npm run build

# Use a lightweight server to serve the built assets
RUN npm install -g serve

EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
