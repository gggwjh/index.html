# Security

- Keep .env and all API keys outside version control.
- Set AI_OS_API_KEY before exposing the API publicly.
- Engine URLs and credentials are server-side configuration; users cannot choose arbitrary remote URLs.
- Put AI OS behind HTTPS and a reverse proxy in production.
- Task data is stored locally in data/tasks.json; use a managed database for larger multi-user deployments.
- Do not expose /api/tasks publicly without authentication in a multi-user deployment.
