package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"drop/internal/auth"
	"drop/internal/db"
	"drop/internal/model"
	"drop/internal/service"
)

// sharingFixture is a real router over a bootstrapped instance with two
// accounts and a bearer token for each — the JSON sharing endpoints, unlike
// most of auth_test.go's cases, need a real drop service and someone besides
// the caller to share with.
type sharingFixture struct {
	router     http.Handler
	tree       *service.Service
	ownerID    uint
	ownerToken string
	otherID    uint
	otherToken string
}

func newSharingFixture(t *testing.T) sharingFixture {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	database, err := db.Open(filepath.Join(t.TempDir(), "sharing.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	accounts := auth.NewService(database,
		auth.NewIssuer(&auth.Keys{Private: key, Public: &key.PublicKey}, "drop-test",
			time.Minute, time.Hour),
		time.Hour)
	tree := service.New(database, nil, "http://localhost:8000")

	router, err := NewRouter(tree, Config{Auth: accounts})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}

	ctx := context.Background()
	owner, err := accounts.Bootstrap(ctx, "owner@drop.test", "owner-password")
	if err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}
	ownerTokens, _, err := accounts.Login(ctx, "owner@drop.test", "owner-password", auth.Device{})
	if err != nil {
		t.Fatalf("Login(owner): %v", err)
	}

	hash, err := auth.HashPassword("other-password")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	other := model.User{Email: "other@drop.test", Name: "Other", PasswordHash: hash, Role: model.RoleUser, Active: true}
	if err := database.Create(&other).Error; err != nil {
		t.Fatalf("create other user: %v", err)
	}
	otherTokens, _, err := accounts.Login(ctx, "other@drop.test", "other-password", auth.Device{})
	if err != nil {
		t.Fatalf("Login(other): %v", err)
	}

	return sharingFixture{
		router:     router,
		tree:       tree,
		ownerID:    owner.ID,
		ownerToken: ownerTokens.AccessToken,
		otherID:    other.ID,
		otherToken: otherTokens.AccessToken,
	}
}

// doJSON sends a request carrying a bearer token and, when body is non-nil, a
// JSON payload — the shape every new /v1 endpoint under test here expects.
func doJSON(t *testing.T, router http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestListSharesShowsGrantsAndCandidates(t *testing.T) {
	f := newSharingFixture(t)
	ctx := context.Background()
	if _, err := f.tree.CreateFolder(ctx, f.ownerID, service.Own(""), "proyectos"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}

	rec := doJSON(t, f.router, http.MethodGet, "/v1/shares?path=proyectos", f.ownerToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/shares: expected 200, got %d (%s)", rec.Code, rec.Body)
	}
	var listed ShareListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(listed.Shares) != 0 {
		t.Fatalf("expected no shares yet, got %d", len(listed.Shares))
	}
	if len(listed.Candidates) != 1 || listed.Candidates[0].Email != "other@drop.test" {
		t.Fatalf("expected the other account as the only candidate, got %+v", listed.Candidates)
	}

	// A stranger with no grant at all is refused the same way a missing path
	// would be — a miss and a denial must be indistinguishable.
	rec = doJSON(t, f.router, http.MethodGet, "/v1/shares?path=proyectos", f.otherToken, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a stranger, got %d (%s)", rec.Code, rec.Body)
	}
}

func TestShareNodeGrantsAndUpserts(t *testing.T) {
	f := newSharingFixture(t)
	ctx := context.Background()
	if _, err := f.tree.CreateFolder(ctx, f.ownerID, service.Own(""), "proyectos"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}

	rec := doJSON(t, f.router, http.MethodPost, "/v1/shares?path=proyectos", f.ownerToken,
		ShareRequest{UserID: f.otherID, Access: model.AccessViewer})
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /v1/shares: expected 200, got %d (%s)", rec.Code, rec.Body)
	}
	var info service.ShareInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if info.Access != service.AccessViewer {
		t.Fatalf("expected viewer access, got %q", info.Access)
	}

	// The grantee can now reach it.
	rec = doJSON(t, f.router, http.MethodGet,
		"/v1/nodes?path=proyectos&owner="+strconv.Itoa(int(f.ownerID)), f.otherToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected the viewer to reach the shared folder, got %d (%s)", rec.Code, rec.Body)
	}

	// Sharing again at a different level updates the same grant rather than
	// creating a second one.
	rec = doJSON(t, f.router, http.MethodPost, "/v1/shares?path=proyectos", f.ownerToken,
		ShareRequest{UserID: f.otherID, Access: model.AccessEditor})
	if rec.Code != http.StatusOK {
		t.Fatalf("re-share: expected 200, got %d (%s)", rec.Code, rec.Body)
	}
	var updated service.ShareInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if updated.ID != info.ID {
		t.Fatalf("expected the same grant row to be updated, got id %d then %d", info.ID, updated.ID)
	}
	if updated.Access != service.AccessEditor {
		t.Fatalf("expected the level to change to editor, got %q", updated.Access)
	}
}

func TestShareNodeCannotShareWithSelf(t *testing.T) {
	f := newSharingFixture(t)
	ctx := context.Background()
	if _, err := f.tree.CreateFolder(ctx, f.ownerID, service.Own(""), "proyectos"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}

	rec := doJSON(t, f.router, http.MethodPost, "/v1/shares?path=proyectos", f.ownerToken,
		ShareRequest{UserID: f.ownerID, Access: model.AccessViewer})
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 already_owner, got %d (%s)", rec.Code, rec.Body)
	}
	var body ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != "already_owner" {
		t.Fatalf("expected code already_owner, got %q", body.Code)
	}
}

func TestUnshareNodeRevokesAccess(t *testing.T) {
	f := newSharingFixture(t)
	ctx := context.Background()
	if _, err := f.tree.CreateFolder(ctx, f.ownerID, service.Own(""), "proyectos"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if _, err := f.tree.Share(ctx, f.ownerID, service.Own("proyectos"), f.otherID, service.AccessViewer); err != nil {
		t.Fatalf("Share: %v", err)
	}

	// A viewer cannot grant shares themselves — CanShare requires editor or
	// owner, and this is the HTTP-layer proof that the 403 is wired through.
	rec := doJSON(t, f.router, http.MethodPost,
		"/v1/shares?path=proyectos&owner="+strconv.Itoa(int(f.ownerID)), f.otherToken,
		ShareRequest{UserID: 999, Access: model.AccessViewer})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a viewer trying to share, got %d (%s)", rec.Code, rec.Body)
	}

	rec = doJSON(t, f.router, http.MethodDelete,
		"/v1/shares?path=proyectos&user_id="+strconv.Itoa(int(f.otherID)), f.ownerToken, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE /v1/shares: expected 204, got %d (%s)", rec.Code, rec.Body)
	}

	rec = doJSON(t, f.router, http.MethodGet,
		"/v1/nodes?path=proyectos&owner="+strconv.Itoa(int(f.ownerID)), f.otherToken, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected the revoked account to lose access, got %d (%s)", rec.Code, rec.Body)
	}
}

func TestListSharedWithMeIsOneDirectional(t *testing.T) {
	f := newSharingFixture(t)
	ctx := context.Background()
	if _, err := f.tree.CreateFolder(ctx, f.ownerID, service.Own(""), "proyectos"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if _, err := f.tree.Share(ctx, f.ownerID, service.Own("proyectos"), f.otherID, service.AccessEditor); err != nil {
		t.Fatalf("Share: %v", err)
	}

	rec := doJSON(t, f.router, http.MethodGet, "/v1/shared", f.otherToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/shared: expected 200, got %d (%s)", rec.Code, rec.Body)
	}
	var shared SharedResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &shared); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(shared.Nodes) != 1 || shared.Nodes[0].Path != "proyectos" || shared.Nodes[0].Access != service.AccessEditor {
		t.Fatalf("unexpected shared nodes: %+v", shared.Nodes)
	}

	rec = doJSON(t, f.router, http.MethodGet, "/v1/shared", f.ownerToken, nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &shared); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(shared.Nodes) != 0 {
		t.Fatalf("sharing is one-directional: the owner must not see their own grant, got %+v", shared.Nodes)
	}
}
