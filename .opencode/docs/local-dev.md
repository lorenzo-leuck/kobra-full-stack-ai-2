# Local development & Docker

## Run

```bash
# Dev, hot reload (docker-compose.override.yml is auto-merged)
docker compose up --build

# Production (no hot reload)
docker compose -f docker-compose.yml up --build
```

Dev reload per service:
- dashboard → Vite HMR
- market-service → `ts-node-dev` respawn
- agent → `uvicorn --reload`

Open <http://localhost:3000>, allow the microphone, press **Talk**.

## How hot reload is wired

Each `Dockerfile` is **multi-stage** with a `dev` and a `prod` target. The
override selects `target: dev`, bind-mounts the source, and forces watch polling:

```yaml
# docker-compose.override.yml (excerpt)
dashboard:
  build: { target: dev }
  environment: [ "VITE_USE_POLLING=1" ]
  volumes:
    - ./apps/dashboard:/app
    - /app/node_modules        # <-- keep the CONTAINER's node_modules
```

### The node_modules gotcha (musl vs glibc)

The containers are `node:20-alpine` (musl). The host's `node_modules` are
usually glibc-built. If you bind-mount the whole app dir without the anonymous
`/app/node_modules` volume, the host's `esbuild`/`vite` native binaries shadow
the container's and Vite fails to start. The anonymous volume preserves the
container-built modules. Keep it.

## Verify (run before claiming done)

```bash
cd apps/dashboard && npx tsc -b && npx vite build
cd apps/market-service && npm run typecheck
python3 -m py_compile apps/agent/src/main.py
docker compose config            # validate the merged compose
```

## Do not

- Read or edit `.env` (use `.env.example`; also blocked by permission rules).
- Add background polling to market-service — `/history` is on-demand + cached.
