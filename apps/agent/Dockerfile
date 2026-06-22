# File: portfolio/kobra-full-stack-ai-2/apps/agent/Dockerfile

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Development stage: uvicorn --reload (hot reload) ---
# Source is bind-mounted at runtime (see docker-compose.override.yml).
FROM base AS dev
EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/src"]

# --- Production stage (default) ---
FROM base AS prod

# Copy app
COPY . .

# App entry
EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
