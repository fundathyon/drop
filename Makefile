API_DIR := apps/api
WEB_DIR := apps/web
GOPATH_BIN := $(shell go env GOPATH)/bin
CERTS_DIR := $(API_DIR)/certs

.DEFAULT_GOAL := help

.PHONY: help install up down dev dev-api dev-web minio minio-down logs seed keys api build build-web run swagger test test-web clean reset

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Download Go modules and install the Bun workspace dependencies
	go -C $(API_DIR) mod download
	bun install

up: keys ## Levanta la app entera — MinIO, API y admin — con un solo comando
	docker compose --profile full up -d --wait --build --remove-orphans
	@echo ""
	@echo "  Panel      http://localhost:3000"
	@echo "  API        http://localhost:8000"
	@echo "  MinIO      http://localhost:9001"
	@echo ""
	@echo "  logs: docker compose --profile full logs -f   ·   parar: make down"

down: ## Baja la app entera
	docker compose --profile full down

dev: minio keys ## Levanta la app entera desde el código, con recarga en caliente: MinIO en Docker, API en :8000 y admin en :3000
	@bun install
	@echo ""
	@echo "  Panel      http://localhost:3000"
	@echo "  API        http://localhost:8000"
	@echo "  Ctrl-C para parar ambos"
	@echo ""
	@# One shell for both halves, with a trap on the process group: Ctrl-C has
	@# to take the API and the frontend down together, or the survivor keeps
	@# holding :8000 (or :3000) and the next `make dev` fails to bind.
	@trap 'kill 0' EXIT INT TERM; \
	go -C $(API_DIR) run ./cmd/dropd & \
	bun run --filter web dev & \
	wait

dev-api: minio keys api ## Solo la API desde el código, en :8000

dev-web: ## Solo el admin desde el código, en :3000 — necesita la API levantada aparte
	bun install
	bun run --filter web dev

keys: $(CERTS_DIR)/private.pem ## Generate the RS256 keypair used to sign tokens

$(CERTS_DIR)/private.pem:
	@# Generated rather than committed: a signing key in version control is a
	@# signing key everyone who ever cloned the repo has.
	mkdir -p $(CERTS_DIR)
	openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $(CERTS_DIR)/private.pem
	openssl rsa -in $(CERTS_DIR)/private.pem -pubout -out $(CERTS_DIR)/public.pem
	chmod 600 $(CERTS_DIR)/private.pem
	@echo "wrote $(CERTS_DIR)/{private,public}.pem"

minio: ## Start just the MinIO stack in the background — what `make dev` needs
	docker compose up -d --wait --remove-orphans

minio-down: ## Stop the MinIO stack
	docker compose down

logs: ## Follow the logs of whatever is running
	docker compose --profile full logs -f

seed: ## Fill the tree with demo content through the running API
	@./scripts/seed.sh

api: keys ## Run the API from source: JSON API and published drops on :8000
	go -C $(API_DIR) run ./cmd/dropd

build: ## Build the API binary
	go -C $(API_DIR) build -o dropd ./cmd/dropd
	@echo "built $(API_DIR)/dropd — start it with: make run"

build-web: ## Build the admin frontend for production
	bun install
	bun run --filter web build

run: keys ## Run the built API binary
	$(API_DIR)/dropd

swagger: ## Regenerate the OpenAPI spec from the handler annotations
	cd $(API_DIR) && $(GOPATH_BIN)/swag init -g cmd/dropd/main.go --parseDependency --parseInternal -o docs

test: ## Run the API tests
	go -C $(API_DIR) test ./... && go -C $(API_DIR) vet ./...

test-web: ## Typecheck, lint and test the admin frontend
	bun install
	bun run --filter web typecheck
	bun run --filter web lint
	bun run --filter web test

clean: ## Remove build output, the local database, and MinIO volumes
	rm -f $(API_DIR)/dropd $(API_DIR)/drop.db
	rm -rf $(WEB_DIR)/.next
	docker compose --profile full down -v

reset: ## Wipe the database and object storage — the next run starts from the setup wizard, as if configured for the first time
	@# The -wal/-shm sidecars matter: delete only the .db and SQLite can replay
	@# a write-ahead log into a brand new file, which brings the old admin back
	@# and the wizard never appears.
	rm -f $(API_DIR)/drop.db $(API_DIR)/drop.db-wal $(API_DIR)/drop.db-shm
	@# Tolerated rather than required: the volumes only exist if the stack has
	@# been up at least once, and `make reset` should still clear the local DB
	@# on a machine with no container runtime running.
	-docker compose --profile full down -v --remove-orphans
	@echo ""
	@echo "  Wiped: local database and MinIO volumes."
	@# Deleting the database is not enough on its own: when both ADMIN_EMAIL and
	@# ADMIN_PASSWORD are set, the API re-creates that administrator on every
	@# fresh boot (apps/api/cmd/dropd/main.go), so /setup redirects straight to
	@# /login and the wizard never appears. Say so instead of promising it.
	@if grep -qE '^[[:space:]]*ADMIN_EMAIL[[:space:]]*=[[:space:]]*[^[:space:]#]' $(API_DIR)/.env 2>/dev/null; then \
		echo ""; \
		echo "  Heads up: $(API_DIR)/.env still sets ADMIN_EMAIL/ADMIN_PASSWORD, so the"; \
		echo "  next boot re-creates that administrator and /setup sends you to /login."; \
		echo "  Comment both lines out first if you want the setup wizard."; \
	else \
		echo "  Next 'make up' (or 'make dev') starts over from /setup."; \
	fi
