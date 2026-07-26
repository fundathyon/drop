API_DIR := api
WEB_DIR := web
GOPATH_BIN := $(shell go env GOPATH)/bin

.DEFAULT_GOAL := help
.PHONY: help dev up down logs install seed api web build swagger test lint clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: up ## Start MinIO, then the API (:8000) and the web app (:3000)
	@$(MAKE) -j2 api web

up: ## Start the MinIO stack in the background
	docker compose up -d --wait --remove-orphans

down: ## Stop the MinIO stack
	docker compose down

logs: ## Follow the MinIO logs
	docker compose logs -f

install: ## Install web dependencies
	cd $(WEB_DIR) && bun install

seed: ## Fill the tree with demo content through the running API
	@./scripts/seed.sh

api: ## Run the Go API on :8000 (docs at /docs)
	cd $(API_DIR) && go run ./cmd/dropd

web: ## Run the Astro dev server on :3000
	cd $(WEB_DIR) && bun run dev

build: ## Build both apps
	cd $(API_DIR) && go build -o dropd ./cmd/dropd
	cd $(WEB_DIR) && bun run build

swagger: ## Regenerate the OpenAPI spec from the handler annotations
	cd $(API_DIR) && $(GOPATH_BIN)/swag init -g cmd/dropd/main.go --parseDependency --parseInternal -o docs

test: ## Run API tests and web type checks
	cd $(API_DIR) && go test ./... && go vet ./...
	cd $(WEB_DIR) && bun run check

clean: ## Remove build output, the local database, and MinIO volumes
	rm -f $(API_DIR)/dropd $(API_DIR)/drop.db
	rm -rf $(WEB_DIR)/dist
	docker compose down -v
