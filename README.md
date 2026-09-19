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

## Current implementation
- Dark responsive dashboard.
- Unified task composer with automatic routing.
- Engine registry and configuration status.
- Task lifecycle API.
- Docker deployment files.
- Environment-based engine endpoints.
- Clear separation between orchestration and third-party engines.

## API
- `GET /health`
- `GET /api/engines`
- `GET /api/tasks`
- `POST /api/tasks` with `{"prompt":"..." }`
- `GET /api/tasks/:id`

## Run
```bash
cp .env.example .env
npm install
npm start
```

Then open `http://localhost:8787`.

## Important deployment note
The repository contains the unified control plane, not copies of the five upstream products. Each engine should run as its own service and be connected through its supported API/webhook. Before commercial multi-tenant deployment, review the current license and terms of every upstream project and obtain any required commercial permissions.
