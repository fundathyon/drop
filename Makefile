API_DIR := api
GOPATH_BIN := $(shell go env GOPATH)/bin
CERTS_DIR := $(API_DIR)/certs

.DEFAULT_GOAL := help

.PHONY: help dev up down logs seed keys api build run swagger test clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: up keys api ## Start MinIO and run the server on :8000

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

logs: ## Follow the MinIO logs
	docker compose logs -f

seed: ## Fill the tree with demo content through the running API
	@./scripts/seed.sh

api: keys ## Run the server from source: admin, API and drops on :8000
	cd $(API_DIR) && go run ./cmd/dropd

build: ## Build the single binary: admin + API + drop server
	cd $(API_DIR) && go build -o dropd ./cmd/dropd
	@echo "built $(API_DIR)/dropd — start it with: make run"

run: keys ## Run the built binary
	cd $(API_DIR) && ./dropd

swagger: ## Regenerate the OpenAPI spec from the handler annotations
	cd $(API_DIR) && $(GOPATH_BIN)/swag init -g cmd/dropd/main.go --parseDependency --parseInternal -o docs

test: ## Run the API tests
	cd $(API_DIR) && go test ./... && go vet ./...

clean: ## Remove build output, the local database, and MinIO volumes
	rm -f $(API_DIR)/dropd $(API_DIR)/drop.db
	docker compose down -v
