package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"drop/internal/auth"
	"drop/internal/model"
)

func TestInvitationByTokenAndAcceptOverJSON(t *testing.T) {
	router, accounts := newAuthedRouter(t)

	tokens, _, err := accounts.Login(context.Background(), "admin@drop.test", "bootstrap-password", auth.Device{})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	rec := doJSON(t, router, http.MethodPost, "/v1/invitations", tokens.AccessToken,
		CreateInvitationRequest{Email: "nuevo@drop.test", Role: model.RoleUser})
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/invitations: expected 201, got %d (%s)", rec.Code, rec.Body)
	}
	var created CreateInvitationResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// The preview is reachable without any session at all.
	rec = doJSON(t, router, http.MethodGet, "/v1/invitations/by-token?token="+created.Token, "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/invitations/by-token: expected 200, got %d (%s)", rec.Code, rec.Body)
	}
	var preview auth.InvitationInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &preview); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if preview.Email != "nuevo@drop.test" || preview.Status != model.InvitationPending {
		t.Fatalf("unexpected preview: %+v", preview)
	}

	// A mistyped confirmation must not burn the single-use link.
	rec = doJSON(t, router, http.MethodPost, "/v1/invitations/accept", "", AcceptInvitationRequest{
		Token: created.Token, Password: "a-strong-password", PasswordConfirm: "different",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for mismatched passwords, got %d (%s)", rec.Code, rec.Body)
	}
	rec = doJSON(t, router, http.MethodGet, "/v1/invitations/by-token?token="+created.Token, "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("the invitation must still be usable after a rejected attempt, got %d", rec.Code)
	}

	// A matching submission creates the account, but — unlike setup — does
	// not sign it in: the password just chosen is what gets used to log in.
	rec = doJSON(t, router, http.MethodPost, "/v1/invitations/accept", "", AcceptInvitationRequest{
		Token: created.Token, Name: "Nuevo", Password: "a-strong-password", PasswordConfirm: "a-strong-password",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/invitations/accept: expected 201, got %d (%s)", rec.Code, rec.Body)
	}
	if cookies := rec.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("accepting an invitation must not open a session, got cookies %+v", cookies)
	}
	var newUser auth.UserInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &newUser); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if newUser.Email != "nuevo@drop.test" || newUser.Name != "Nuevo" {
		t.Fatalf("unexpected new user: %+v", newUser)
	}

	// The link is single-use: it is gone once accepted.
	rec = doJSON(t, router, http.MethodGet, "/v1/invitations/by-token?token="+created.Token, "", nil)
	if rec.Code != http.StatusGone {
		t.Fatalf("expected 410 for an already-accepted invitation, got %d (%s)", rec.Code, rec.Body)
	}
	rec = doJSON(t, router, http.MethodPost, "/v1/invitations/accept", "", AcceptInvitationRequest{
		Token: created.Token, Password: "another-password", PasswordConfirm: "another-password",
	})
	if rec.Code != http.StatusGone {
		t.Fatalf("expected 410 accepting an already-used invitation a second time, got %d (%s)", rec.Code, rec.Body)
	}
}

func TestInvitationByTokenRejectsUnknownToken(t *testing.T) {
	router, _ := newAuthedRouter(t)

	rec := doJSON(t, router, http.MethodGet, "/v1/invitations/by-token?token=does-not-exist", "", nil)
	if rec.Code != http.StatusGone {
		t.Fatalf("expected 410 for an unknown token, got %d (%s)", rec.Code, rec.Body)
	}
}
