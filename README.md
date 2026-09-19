# AI OS — Unified AI Workspace

منصة موحّدة تجمع طبقة Orchestrator واحدة فوق محركات متخصصة بدل دمج مشاريعها داخل monolith واحد.

## Architecture
User → AI OS UI/API → Orchestrator → Dify / n8n / OpenHands / Browser Use / LangGraph

### Engines
- **Dify**: AI apps, RAG, workflows
- **n8n**: automation and integrations
- **OpenHands**: coding/software engineering
- **Browser Use**: browser execution
- **LangGraph**: controllable agent orchestration

## Included now
- RTL responsive dark dashboard.
- Automatic engine routing + manual engine override.
- Persistent task storage in `data/tasks.json`.
- Task status, results, errors, attempts and retry endpoint.
- API-key authentication via `AI_OS_API_KEY`.
- Request rate limiting and prompt-size limits.
- Security response headers.
- Metrics endpoint.
- Docker + production compose with persistent volume and healthcheck.
- Node unit tests and GitHub Actions validation.
- Engine credentials stay server-side and are never returned by the config API.

## API
- `GET /health` — public health check
- `GET /api/engines`
- `GET /api/config`
- `GET /api/metrics`
- `GET /api/tasks`
- `POST /api/tasks` with `{"prompt":"..." }`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/retry`
- `DELETE /api/tasks/:id`

When `AI_OS_API_KEY` is set, API routes require either `x-api-key` or `Authorization: Bearer ...`.

## Run
```bash
cp .env.example .env
npm install
npm test
npm start
```

Then open `http://localhost:8787`.

## Production
Use `docker-compose.prod.yml` for a persistent container volume and healthcheck. Put the service behind HTTPS/reverse proxy and set `AI_OS_API_KEY`.

The repository is the control plane; the five upstream engines remain separate services and must be connected through their supported APIs/webhooks. Review the current license and terms of each upstream project before commercial multi-tenant deployment.


## Release hardening
- Production mode refuses to start without `AI_OS_API_KEY`.
- `/ready` checks persistent storage for container orchestration.
- Task execution is concurrency-limited and retry-limited.
- Task persistence is serialized to prevent concurrent write loss.
- Results are size-limited and old inactive tasks are pruned.
- Malformed/oversized JSON requests return JSON errors.
- Security headers include CSP and Permissions Policy.
- CI includes an HTTP integration test covering health, authentication and task lifecycle.

## Engine integration
Engine URLs and credentials are intentionally server-side. AI OS does not invent or bundle the five upstream runtimes; each must expose a compatible HTTP endpoint. Paths are configurable through `.env`, so upstream API changes do not require changing the UI.
