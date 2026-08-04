API_DIR := api
WEB_DIR := web
GOPATH_BIN := $(shell go env GOPATH)/bin
CERTS_DIR := $(API_DIR)/certs

.DEFAULT_GOAL := help

.PHONY: help dev dev-web up down up-all down-all logs seed keys api build build-web run swagger test test-web clean reset

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: up keys api ## Start MinIO and run the API from source on :8000 (run `make dev-web` too for the admin UI)

dev-web: ## Run the admin frontend from source on :3000 — needs `make dev` running in another terminal
	cd $(WEB_DIR) && bun install && bun run dev

keys: $(CERTS_DIR)/private.pem ## Generate the RS256 keypair used to sign tokens

$(CERTS_DIR)/private.pem:
	@# Generated rather than committed: a signing key in version control is a
	@# signing key everyone who ever cloned the repo has.
	mkdir -p $(CERTS_DIR)
	openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $(CERTS_DIR)/private.pem
	openssl rsa -in $(CERTS_DIR)/private.pem -pubout -out $(CERTS_DIR)/public.pem
	chmod 600 $(CERTS_DIR)/private.pem
	@echo "wrote $(CERTS_DIR)/{private,public}.pem"

up: ## Start the MinIO stack in the background
	docker compose up -d --wait --remove-orphans

down: ## Stop the MinIO stack
	docker compose down

up-all: keys ## Build and start the whole stack — MinIO, API and web — in one command
	docker compose --profile full up -d --wait --build --remove-orphans

down-all: ## Stop the whole stack started by `make up-all`
	docker compose --profile full down

logs: ## Follow the MinIO logs
	docker compose logs -f

seed: ## Fill the tree with demo content through the running API
	@./scripts/seed.sh

api: keys ## Run the API from source: JSON API and published drops on :8000
	cd $(API_DIR) && go run ./cmd/dropd

build: ## Build the API binary
	cd $(API_DIR) && go build -o dropd ./cmd/dropd
	@echo "built $(API_DIR)/dropd — start it with: make run"

build-web: ## Build the admin frontend for production
	cd $(WEB_DIR) && bun install && bun run build

run: keys ## Run the built API binary
	cd $(API_DIR) && ./dropd

swagger: ## Regenerate the OpenAPI spec from the handler annotations
	cd $(API_DIR) && $(GOPATH_BIN)/swag init -g cmd/dropd/main.go --parseDependency --parseInternal -o docs

test: ## Run the API tests
	cd $(API_DIR) && go test ./... && go vet ./...

test-web: ## Typecheck, lint and test the admin frontend
	cd $(WEB_DIR) && bun install && bun run typecheck && bun run lint && bun run test

clean: ## Remove build output, the local database, and MinIO volumes
	rm -f $(API_DIR)/dropd $(API_DIR)/drop.db
	docker compose down -v

reset: ## Wipe the database and object storage — the next run starts from the setup wizard, as if configured for the first time
	rm -f $(API_DIR)/drop.db
	docker compose --profile full down -v --remove-orphans
	@echo "Wiped. Run 'make dev' (or 'make up-all') to start over from /setup."
