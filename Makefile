.PHONY: up down build logs shell-db test-smoke

# Sync Extension Environment
sync-ext:
	cd extension && npm install && node sync-env.js

# Start full stack
up: sync-ext
	docker compose up --build

# Start in background
up-detach:
	docker compose up --build -d

# Stop everything
down:
	docker compose down

# View logs
logs:
	docker compose logs -f backend

# Open a psql shell
shell-db:
	docker compose exec postgres psql -U mindvault -d mindvault

# Run smoke tests (backend must be running)
test-smoke:
	cd backend && python test_smoke.py

# Install backend deps locally (for development without Docker)
install-backend:
	cd backend && pip install -r requirements.txt

# Install frontend deps locally
install-frontend:
	cd frontend && npm install

# Run backend locally (without Docker)
dev-backend:
	cd backend && uvicorn main:app --reload --port 8000

# Run frontend locally (without Docker)
dev-frontend:
	cd frontend && npm run dev
