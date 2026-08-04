package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSetupStatusAndSetupOverJSON(t *testing.T) {
	router, accounts := newSetupRouter(t)

	rec := doJSON(t, router, http.MethodGet, "/v1/setup/status", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/setup/status: expected 200, got %d (%s)", rec.Code, rec.Body)
	}
	var status SetupStatusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !status.NeedsSetup {
		t.Fatal("expected needs_setup=true on a fresh instance")
	}

	// Mismatched passwords are rejected before anything is created.
	rec = doJSON(t, router, http.MethodPost, "/v1/setup", "", SetupRequest{
		OrgName: "Acme", Email: "admin@drop.test",
		Password: "a-strong-password", PasswordConfirm: "different",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for mismatched passwords, got %d (%s)", rec.Code, rec.Body)
	}
	if still, err := accounts.NeedsSetup(context.Background()); err != nil || !still {
		t.Fatalf("a rejected submission must not have created anything: needsSetup=%v err=%v", still, err)
	}

	// A matching submission creates the organization and administrator, and
	// signs them in — same shape as login.
	rec = doJSON(t, router, http.MethodPost, "/v1/setup", "", SetupRequest{
		OrgName: "Acme", Name: "Admin", Email: "admin@drop.test",
		Password: "a-strong-password", PasswordConfirm: "a-strong-password",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /v1/setup: expected 200, got %d (%s)", rec.Code, rec.Body)
	}
	var tokens TokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &tokens); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if tokens.AccessToken == "" || tokens.User.Email != "admin@drop.test" {
		t.Fatalf("expected a token response for the new administrator, got %+v", tokens)
	}

	rec = doJSON(t, router, http.MethodGet, "/v1/setup/status", "", nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if status.NeedsSetup {
		t.Fatal("expected needs_setup=false once set up")
	}

	// A second submission loses the race: it is told the instance is already
	// set up rather than allowed to create a second organization.
	rec = doJSON(t, router, http.MethodPost, "/v1/setup", "", SetupRequest{
		OrgName: "Otra", Email: "otro@drop.test",
		Password: "another-password", PasswordConfirm: "another-password",
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 already_set_up, got %d (%s)", rec.Code, rec.Body)
	}
}

// TestSetupGateExemptsJSONSetupRoutes is the JSON counterpart of
// TestSetupGate: the two new routes must be reachable before an
// administrator exists, and nothing else under /v1 should be.
func TestSetupGateExemptsJSONSetupRoutes(t *testing.T) {
	router, _ := newSetupRouter(t)

	cases := []struct {
		name   string
		method string
		path   string
		want   int
	}{
		{"status is reachable", http.MethodGet, "/v1/setup/status", http.StatusOK},
		{"setup itself is reachable (even a bad body reaches the handler)",
			http.MethodPost, "/v1/setup", http.StatusBadRequest},
		{"everything else under /v1 stays gated", http.MethodGet, "/v1/nodes?path=", http.StatusServiceUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if rec.Code != tc.want {
				t.Fatalf("%s %s: expected %d, got %d (%s)", tc.method, tc.path, tc.want, rec.Code, rec.Body)
			}
		})
	}
}
