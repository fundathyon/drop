API_DIR := api
WEB_DIR := web
# Where the built admin lands so the Go binary can embed it: go:embed cannot
# reach outside its own package, hence the copy instead of pointing at web/dist.
ADMIN_DIST := $(API_DIR)/internal/adminui/dist
GOPATH_BIN := $(shell go env GOPATH)/bin

.DEFAULT_GOAL := help
.PHONY: help dev up down logs install seed api web admin build run swagger test lint clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: up ## Develop with hot reload: API (:8000) and the web dev server (:3000)
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

admin: ## Build the admin UI into the binary's embed directory
	@# PUBLIC_DROP_API_URL is deliberately empty: the embedded admin is served
	@# by the API itself, so it must call it same-origin. Baking in an absolute
	@# URL would pin the build to one host.
	cd $(WEB_DIR) && PUBLIC_DROP_API_URL= bun run build
	@# .gitkeep is what keeps the directory in a fresh clone, and go:embed does
	@# not compile without it — so the old build is cleared around it, never
	@# with an rm -rf of the directory itself.
	mkdir -p $(ADMIN_DIST)
	find $(ADMIN_DIST) -mindepth 1 ! -name .gitkeep -delete
	cp -R $(WEB_DIR)/dist/. $(ADMIN_DIST)/
	touch $(ADMIN_DIST)/.gitkeep

build: admin ## Build the single binary: admin + API + drop server
	cd $(API_DIR) && go build -o dropd ./cmd/dropd
	@echo "built $(API_DIR)/dropd — start it with: make run"

run: ## Run the built binary: admin, API and drops all on :8000
	cd $(API_DIR) && ./dropd

swagger: ## Regenerate the OpenAPI spec from the handler annotations
	cd $(API_DIR) && $(GOPATH_BIN)/swag init -g cmd/dropd/main.go --parseDependency --parseInternal -o docs

test: ## Run API tests and web type checks
	cd $(API_DIR) && go test ./... && go vet ./...
	cd $(WEB_DIR) && bun run check

clean: ## Remove build output, the local database, and MinIO volumes
	rm -f $(API_DIR)/dropd $(API_DIR)/drop.db
	rm -rf $(WEB_DIR)/dist
	mkdir -p $(ADMIN_DIST)
	find $(ADMIN_DIST) -mindepth 1 ! -name .gitkeep -delete
	touch $(ADMIN_DIST)/.gitkeep
	docker compose down -v
