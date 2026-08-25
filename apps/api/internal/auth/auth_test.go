package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"drop/internal/db"
	"drop/internal/model"
)

func testIssuer(t *testing.T) *Issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return NewIssuer(&Keys{Private: key, Public: &key.PublicKey}, "drop-test", time.Minute, time.Hour)
}

func testService(t *testing.T) *Service {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	return NewService(database, testIssuer(t), time.Hour)
}

// ---------- passwords ----------

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("un secreto razonablemente largo")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if strings.Contains(hash, "un secreto") {
		t.Fatal("the password leaked into its own hash")
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("expected a PHC string, got %q", hash)
	}
	if err := VerifyPassword("un secreto razonablemente largo", hash); err != nil {
		t.Errorf("the right password should verify: %v", err)
	}
	if err := VerifyPassword("otra cosa", hash); !errors.Is(err, ErrPasswordMismatch) {
		t.Errorf("expected ErrPasswordMismatch, got %v", err)
	}
}

func TestPasswordHashesAreSalted(t *testing.T) {
	// Two hashes of the same password must differ, or the table becomes a
	// lookup of who shares a password with whom.
	a, _ := HashPassword("misma")
	b, _ := HashPassword("misma")
	if a == b {
		t.Fatal("identical passwords produced identical hashes: the salt is not doing its job")
	}
}

func TestVerifyRejectsMalformedHashes(t *testing.T) {
	for _, bad := range []string{
		"", "not a hash", "$argon2id$", "$bcrypt$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=1,t=1,p=1$!!!$aGFzaA",
	} {
		if err := VerifyPassword("x", bad); err == nil {
			t.Errorf("%q should not verify against anything", bad)
		}
	}
}

// ---------- tokens ----------

func TestAccessAndRefreshAreNotInterchangeable(t *testing.T) {
	issuer := testIssuer(t)

	access, _, err := issuer.Access(7, "admin")
	if err != nil {
		t.Fatalf("Access: %v", err)
	}
	refresh, _, err := issuer.Refresh(7, 3)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}

	claims, err := issuer.Verify(access, KindAccess)
	if err != nil {
		t.Fatalf("an access token should verify as one: %v", err)
	}
	if id, _ := claims.UserID(); id != 7 || claims.Role != "admin" {
		t.Errorf("unexpected claims: %+v", claims)
	}

	// The point of a short access lifetime is lost if the month-long refresh
	// token is accepted in its place.
	if _, err := issuer.Verify(refresh, KindAccess); !errors.Is(err, ErrInvalidToken) {
		t.Error("a refresh token must not pass as an access token")
	}
	if _, err := issuer.Verify(access, KindRefresh); !errors.Is(err, ErrInvalidToken) {
		t.Error("an access token must not pass as a refresh token")
	}

	if claims, err = issuer.Verify(refresh, KindRefresh); err != nil || claims.SessionID != 3 {
		t.Errorf("refresh token should carry its session: %+v %v", claims, err)
	}
}

func TestVerifyRejectsForgedAlgorithms(t *testing.T) {
	issuer := testIssuer(t)
	claims := Claims{
		Kind: KindAccess,
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "1",
			Issuer:    "drop-test",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}

	// "alg": "none" — the classic. Nothing signed it at all.
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).
		SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("build unsigned token: %v", err)
	}
	if _, err := issuer.Verify(unsigned, KindAccess); !errors.Is(err, ErrInvalidToken) {
		t.Error("an unsigned token must be rejected")
	}

	// The other half of the confusion attack: re-sign with HS256 using the
	// public key as the shared secret. Only works if the verifier trusts the
	// algorithm named in the token.
	pubDER, err := x509.MarshalPKIXPublicKey(issuer.keys.Public)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(pubPEM)
	if err != nil {
		t.Fatalf("build forged token: %v", err)
	}
	if _, err := issuer.Verify(forged, KindAccess); !errors.Is(err, ErrInvalidToken) {
		t.Error("an HS256 token signed with the public key must be rejected")
	}
}

func TestVerifyRejectsExpiredAndForeignTokens(t *testing.T) {
	issuer := testIssuer(t)

	expired := NewIssuer(issuer.keys, "drop-test", -time.Minute, -time.Minute)
	token, _, err := expired.Access(1, "user")
	if err != nil {
		t.Fatalf("Access: %v", err)
	}
	if _, err := issuer.Verify(token, KindAccess); !errors.Is(err, ErrInvalidToken) {
		t.Error("an expired token must be rejected")
	}

	// Signed by a different key entirely.
	other := testIssuer(t)
	token, _, _ = other.Access(1, "admin")
	if _, err := issuer.Verify(token, KindAccess); !errors.Is(err, ErrInvalidToken) {
		t.Error("a token signed by another key must be rejected")
	}
}

func TestLoadKeysRejectsAMismatchedPair(t *testing.T) {
	dir := t.TempDir()
	a, _ := rsa.GenerateKey(rand.Reader, 2048)
	b, _ := rsa.GenerateKey(rand.Reader, 2048)

	privatePath := filepath.Join(dir, "private.pem")
	publicPath := filepath.Join(dir, "public.pem")

	privDER, _ := x509.MarshalPKCS8PrivateKey(a)
	os.WriteFile(privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER}), 0o600)
	pubDER, _ := x509.MarshalPKIXPublicKey(&b.PublicKey)
	os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}), 0o644)

	// Caught at startup: otherwise every token issued would be signed happily
	// and rejected by every verifier.
	if _, err := LoadKeys(privatePath, publicPath); err == nil {
		t.Fatal("expected a mismatched keypair to be refused")
	}

	pubDER, _ = x509.MarshalPKIXPublicKey(&a.PublicKey)
	os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}), 0o644)
	if _, err := LoadKeys(privatePath, publicPath); err != nil {
		t.Fatalf("a matching pair should load: %v", err)
	}
}

func TestKeysFromPEMLoadsAMatchingPair(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privDER, _ := x509.MarshalPKCS8PrivateKey(key)
	pubDER, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})

	keys, err := KeysFromPEM(privatePEM, publicPEM)
	if err != nil {
		t.Fatalf("KeysFromPEM: %v", err)
	}
	if !keys.Private.PublicKey.Equal(keys.Public) {
		t.Fatal("loaded keypair does not match itself")
	}
}

// TestKeysFromPEMUnescapesLiteralNewlines covers the shape a keypair usually
// arrives in from a platform whose environment variables are single-line
// text fields: line breaks pasted or generated as the two characters `\`,
// `n` rather than an actual newline byte.
func TestKeysFromPEMUnescapesLiteralNewlines(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privDER, _ := x509.MarshalPKCS8PrivateKey(key)
	pubDER, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})

	escape := func(b []byte) []byte {
		return []byte(strings.ReplaceAll(string(b), "\n", `\n`))
	}

	if _, err := KeysFromPEM(escape(privatePEM), escape(publicPEM)); err != nil {
		t.Fatalf("KeysFromPEM with escaped newlines: %v", err)
	}
}

// TestKeysFromPEMRewrapsSpaceCollapsedPEM covers Dokploy specifically: it
// stores a single-line env var value with every newline turned into a plain
// space rather than an escaped `\n`, which loses the line structure a PEM
// block needs entirely — it has to be rebuilt from the header/footer markers
// instead of just swapping a character back for another.
func TestKeysFromPEMRewrapsSpaceCollapsedPEM(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privDER, _ := x509.MarshalPKCS8PrivateKey(key)
	pubDER, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: privDER})
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})

	collapse := func(b []byte) []byte {
		return []byte(strings.Join(strings.Fields(strings.ReplaceAll(string(b), "\n", " ")), " "))
	}

	keys, err := KeysFromPEM(collapse(privatePEM), collapse(publicPEM))
	if err != nil {
		t.Fatalf("KeysFromPEM with space-collapsed newlines: %v", err)
	}
	if !keys.Private.PublicKey.Equal(keys.Public) {
		t.Fatal("recovered keypair does not match itself")
	}
}

func TestKeysFromPEMRejectsAMismatchedPair(t *testing.T) {
	a, _ := rsa.GenerateKey(rand.Reader, 2048)
	b, _ := rsa.GenerateKey(rand.Reader, 2048)

	privDER, _ := x509.MarshalPKCS8PrivateKey(a)
	pubDER, _ := x509.MarshalPKIXPublicKey(&b.PublicKey)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})

	if _, err := KeysFromPEM(privatePEM, publicPEM); err == nil {
		t.Fatal("expected a mismatched keypair to be refused")
	}
}

// ---------- bootstrap and login ----------

func TestBootstrapIsIdempotentAndNeverOverwrites(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	if _, err := svc.Bootstrap(ctx, "Admin@Drop.Local", "primera"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}
	// The address is normalized, so case in the environment does not create a
	// second account on the next start.
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "segunda"); err != nil {
		t.Fatalf("Bootstrap again: %v", err)
	}

	users, err := svc.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("expected a single administrator, got %d", len(users))
	}

	// An admin who changed their password must not have it reset by a restart.
	if _, _, err := svc.Login(ctx, "admin@drop.local", "primera", Device{}); err != nil {
		t.Errorf("the original password should still work: %v", err)
	}
	if _, _, err := svc.Login(ctx, "admin@drop.local", "segunda", Device{}); !errors.Is(err, ErrInvalidCredentials) {
		t.Error("bootstrap must not overwrite an existing password")
	}
}

func TestLoginDoesNotRevealWhoHasAnAccount(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	_, _, unknown := svc.Login(ctx, "nadie@drop.local", "contraseña-larga", Device{})
	_, _, wrong := svc.Login(ctx, "admin@drop.local", "incorrecta", Device{})

	// Same error either way: a different one would turn the form into a way to
	// find out which addresses are registered.
	if !errors.Is(unknown, ErrInvalidCredentials) || !errors.Is(wrong, ErrInvalidCredentials) {
		t.Fatalf("expected the same error; unknown=%v wrong=%v", unknown, wrong)
	}
}

func TestDisablingAUserEndsTheirSessions(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	_, invited := mustInvite(t, svc, "otro@drop.local", model.RoleUser)
	if _, err := svc.AcceptInvitation(ctx, invited, "Otro", "otra-contraseña"); err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}

	tokens, user, err := svc.Login(ctx, "otro@drop.local", "otra-contraseña", Device{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if _, _, err := svc.Refresh(ctx, tokens.RefreshToken); err != nil {
		t.Fatalf("the fresh token should refresh: %v", err)
	}

	admin, _ := svc.ListUsers(ctx)
	if _, err := svc.SetUserActive(ctx, user.ID, false, admin[0].ID); err != nil {
		t.Fatalf("SetUserActive: %v", err)
	}

	// Not "once the access token expires": disabling has to bite now.
	if _, _, err := svc.Refresh(ctx, tokens.RefreshToken); err == nil {
		t.Error("a disabled user must not be able to refresh")
	}
	if _, _, err := svc.Login(ctx, "otro@drop.local", "otra-contraseña", Device{}); !errors.Is(err, ErrAccountDisabled) {
		t.Error("a disabled user must not be able to log in")
	}
}

func TestLogoutRevokesOnlyThatSession(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	phone, _, err := svc.Login(ctx, "admin@drop.local", "contraseña-larga", Device{UserAgent: "phone"})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	laptop, _, err := svc.Login(ctx, "admin@drop.local", "contraseña-larga", Device{UserAgent: "laptop"})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	if err := svc.Logout(ctx, phone.RefreshToken); err != nil {
		t.Fatalf("Logout: %v", err)
	}

	if _, _, err := svc.Refresh(ctx, phone.RefreshToken); err == nil {
		t.Error("the signed-out session must be dead")
	}
	if _, _, err := svc.Refresh(ctx, laptop.RefreshToken); err != nil {
		t.Errorf("the other device should still be signed in: %v", err)
	}
}

// ---------- setup ----------

func TestNeedsSetupReflectsWhetherAnAdministratorExists(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	needs, err := svc.NeedsSetup(ctx)
	if err != nil {
		t.Fatalf("NeedsSetup: %v", err)
	}
	if !needs {
		t.Fatal("a fresh instance should need setup")
	}

	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	needs, err = svc.NeedsSetup(ctx)
	if err != nil {
		t.Fatalf("NeedsSetup: %v", err)
	}
	if needs {
		t.Fatal("an instance with an administrator should not need setup")
	}
}

func TestSetupInstanceCreatesOrganizationAndAdministrator(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	tokens, admin, err := svc.SetupInstance(ctx, "Acme", "Admin", "admin@drop.local", "contraseña-larga", Device{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("SetupInstance: %v", err)
	}
	if admin.Role != model.RoleAdmin || !admin.Active {
		t.Fatalf("expected an active administrator, got %+v", admin)
	}
	if tokens.AccessToken == "" || tokens.RefreshToken == "" {
		t.Fatal("expected SetupInstance to sign the administrator in")
	}
	if _, _, err := svc.Refresh(ctx, tokens.RefreshToken); err != nil {
		t.Errorf("the session opened by setup should be usable: %v", err)
	}

	var stored model.User
	if err := svc.db.First(&stored, admin.ID).Error; err != nil {
		t.Fatalf("load stored user: %v", err)
	}
	if stored.OrganizationID == 0 {
		t.Fatal("the administrator should belong to the organization setup created")
	}

	var org model.Organization
	if err := svc.db.First(&org, stored.OrganizationID).Error; err != nil {
		t.Fatalf("load organization: %v", err)
	}
	if org.Name != "Acme" {
		t.Errorf("expected the organization name to be %q, got %q", "Acme", org.Name)
	}

	if needs, err := svc.NeedsSetup(ctx); err != nil {
		t.Fatalf("NeedsSetup: %v", err)
	} else if needs {
		t.Fatal("the instance should be set up after SetupInstance succeeds")
	}
}

func TestSetupInstanceOnlyRunsOnce(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	if _, _, err := svc.SetupInstance(ctx, "Acme", "Admin", "admin@drop.local", "contraseña-larga", Device{}); err != nil {
		t.Fatalf("SetupInstance: %v", err)
	}
	if _, _, err := svc.SetupInstance(ctx, "Otra", "Otro", "otro@drop.local", "otra-contraseña", Device{}); !errors.Is(err, ErrAlreadySetUp) {
		t.Fatalf("expected ErrAlreadySetUp, got %v", err)
	}

	// The refused second attempt must not have touched what the first created.
	users, err := svc.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("expected exactly one account, got %d", len(users))
	}
}

func TestSetupInstanceValidatesInput(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name, org, email, password string
	}{
		{"blank organization", "", "admin@drop.local", "contraseña-larga"},
		{"malformed email", "Acme", "not-an-email", "contraseña-larga"},
		{"short password", "Acme", "admin@drop.local", "corta"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := testService(t)
			if _, _, err := svc.SetupInstance(ctx, tc.org, "Admin", tc.email, tc.password, Device{}); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestBackfillOrganizationsIsANoOpOnAFreshInstance(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	n, err := svc.BackfillOrganizations(ctx)
	if err != nil {
		t.Fatalf("BackfillOrganizations: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected no accounts to backfill, got %d", n)
	}
}

// TestBackfillOrganizationsAdoptsAccountsFromBeforeOrganizationsExisted covers
// what main.go relies on: a headlessly bootstrapped administrator, and any
// account from a database written before organization_id existed, both still
// sit at the migration's placeholder value until this runs.
func TestBackfillOrganizationsAdoptsAccountsFromBeforeOrganizationsExisted(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	n, err := svc.BackfillOrganizations(ctx)
	if err != nil {
		t.Fatalf("BackfillOrganizations: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 account backfilled, got %d", n)
	}

	var user model.User
	if err := svc.db.Where("email = ?", "admin@drop.local").First(&user).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if user.OrganizationID == 0 {
		t.Fatal("expected the account to have been given an organization")
	}

	// Idempotent: nothing left to backfill on a second pass.
	n, err = svc.BackfillOrganizations(ctx)
	if err != nil {
		t.Fatalf("BackfillOrganizations again: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected nothing left to backfill the second time, got %d", n)
	}
}

func TestAcceptInvitationJoinsTheExistingOrganization(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	_, admin, err := svc.SetupInstance(ctx, "Acme", "Admin", "admin@drop.local", "contraseña-larga", Device{})
	if err != nil {
		t.Fatalf("SetupInstance: %v", err)
	}

	_, token := mustInvite(t, svc, "otro@drop.local", model.RoleUser)
	invited, err := svc.AcceptInvitation(ctx, token, "Otro", "otra-contraseña")
	if err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}

	var invitedUser, adminUser model.User
	if err := svc.db.First(&invitedUser, invited.ID).Error; err != nil {
		t.Fatalf("load invited user: %v", err)
	}
	if err := svc.db.First(&adminUser, admin.ID).Error; err != nil {
		t.Fatalf("load admin user: %v", err)
	}
	if invitedUser.OrganizationID != adminUser.OrganizationID {
		t.Fatalf("expected the invited user to join the same organization, got %d vs %d",
			invitedUser.OrganizationID, adminUser.OrganizationID)
	}
}

// TestAcceptInvitationCreatesADefaultOrganizationWhenNoneExists exists because
// every other invitation test in this file accepts one without ever calling
// SetupInstance or Bootstrap first — ensureOrganization's fallback is what
// keeps them (and any real invitation predating organizations) working.
func TestAcceptInvitationCreatesADefaultOrganizationWhenNoneExists(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	_, token := mustInvite(t, svc, "otro@drop.local", model.RoleUser)
	invited, err := svc.AcceptInvitation(ctx, token, "Otro", "otra-contraseña")
	if err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}

	var stored model.User
	if err := svc.db.First(&stored, invited.ID).Error; err != nil {
		t.Fatalf("load invited user: %v", err)
	}
	if stored.OrganizationID == 0 {
		t.Fatal("expected AcceptInvitation to create a default organization")
	}
}

// ---------- invitations ----------

func mustInvite(t *testing.T, svc *Service, email string, role model.Role) (InvitationInfo, string) {
	t.Helper()
	info, token, err := svc.CreateInvitation(context.Background(), email, role, 1)
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}
	return info, token
}

func TestInvitationIsSingleUse(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	_, token := mustInvite(t, svc, "nuevo@drop.local", model.RoleUser)

	if _, err := svc.InvitationByToken(ctx, token); err != nil {
		t.Fatalf("a pending invitation should resolve: %v", err)
	}
	if _, err := svc.AcceptInvitation(ctx, token, "Nuevo", "contraseña-larga"); err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}
	// Reusing the link must not create a second account on the same address.
	if _, err := svc.AcceptInvitation(ctx, token, "Otro", "contraseña-larga"); !errors.Is(err, ErrInvalidInvitation) {
		t.Errorf("expected the link to be spent, got %v", err)
	}

	users, _ := svc.ListUsers(ctx)
	if len(users) != 1 {
		t.Fatalf("expected exactly one user, got %d", len(users))
	}
}

func TestInvitationRejectsExpiredRevokedAndUnknownTokens(t *testing.T) {
	ctx := context.Background()

	t.Run("expired", func(t *testing.T) {
		svc := testService(t)
		svc.invitationTTL = -time.Minute // already in the past
		_, token := mustInvite(t, svc, "tarde@drop.local", model.RoleUser)

		if _, err := svc.AcceptInvitation(ctx, token, "", "contraseña-larga"); !errors.Is(err, ErrInvalidInvitation) {
			t.Fatalf("expected ErrInvalidInvitation, got %v", err)
		}
		// The status catches up with the clock rather than staying "pending".
		list, _ := svc.ListInvitations(ctx)
		if len(list) != 1 || list[0].Status != model.InvitationExpired {
			t.Errorf("expected it recorded as expired, got %+v", list)
		}
	})

	t.Run("revoked", func(t *testing.T) {
		svc := testService(t)
		info, token := mustInvite(t, svc, "revocado@drop.local", model.RoleUser)
		if _, err := svc.RevokeInvitation(ctx, info.ID); err != nil {
			t.Fatalf("RevokeInvitation: %v", err)
		}
		if _, err := svc.AcceptInvitation(ctx, token, "", "contraseña-larga"); !errors.Is(err, ErrInvalidInvitation) {
			t.Errorf("a revoked link must not work, got %v", err)
		}
	})

	t.Run("unknown", func(t *testing.T) {
		svc := testService(t)
		for _, token := range []string{"", "inventado", strings.Repeat("a", 43)} {
			if _, err := svc.InvitationByToken(ctx, token); !errors.Is(err, ErrInvalidInvitation) {
				t.Errorf("token %q should not resolve, got %v", token, err)
			}
		}
	})
}

func TestReissuingAnInvitationSupersedesTheOldLink(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	_, first := mustInvite(t, svc, "dup@drop.local", model.RoleUser)
	_, second := mustInvite(t, svc, "dup@drop.local", model.RoleUser)

	if _, err := svc.InvitationByToken(ctx, first); !errors.Is(err, ErrInvalidInvitation) {
		t.Error("the superseded link must stop working")
	}
	if _, err := svc.InvitationByToken(ctx, second); err != nil {
		t.Errorf("the newest link should work: %v", err)
	}
}

func TestInvitationValidation(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}

	for _, email := range []string{"", "sin-arroba", "@drop.local", "a@b", "con espacio@drop.local"} {
		if _, _, err := svc.CreateInvitation(ctx, email, model.RoleUser, 1); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("email %q should be rejected, got %v", email, err)
		}
	}
	if _, _, err := svc.CreateInvitation(ctx, "x@drop.local", "superuser", 1); !errors.Is(err, ErrInvalidInput) {
		t.Error("an unknown role should be rejected")
	}
	// Someone who already has an account is not invited again.
	if _, _, err := svc.CreateInvitation(ctx, "admin@drop.local", model.RoleUser, 1); !errors.Is(err, ErrExists) {
		t.Error("inviting an existing account should be refused")
	}

	_, token := mustInvite(t, svc, "corta@drop.local", model.RoleUser)
	if _, err := svc.AcceptInvitation(ctx, token, "", "corta"); !errors.Is(err, ErrInvalidInput) {
		t.Error("a short password should be rejected")
	}
}

// ---------- administration ----------

func TestTheLastAdministratorCannotBeRemoved(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}
	users, _ := svc.ListUsers(ctx)
	admin := users[0]

	// Acting as somebody else, so this is the last-admin rule rather than the
	// don't-lock-yourself-out one.
	const other = uint(999)
	if _, err := svc.SetUserActive(ctx, admin.ID, false, other); !errors.Is(err, ErrLastAdmin) {
		t.Errorf("expected ErrLastAdmin, got %v", err)
	}
	if err := svc.DeleteUser(ctx, admin.ID, other); !errors.Is(err, ErrLastAdmin) {
		t.Errorf("expected ErrLastAdmin, got %v", err)
	}

	// With a second administrator, the first can go.
	_, token := mustInvite(t, svc, "admin2@drop.local", model.RoleAdmin)
	second, err := svc.AcceptInvitation(ctx, token, "Segunda", "contraseña-larga")
	if err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}
	if _, err := svc.SetUserActive(ctx, admin.ID, false, second.ID); err != nil {
		t.Errorf("with another admin present this should be allowed: %v", err)
	}
}

func TestAnAdminCannotLockThemselvesOut(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}
	_, token := mustInvite(t, svc, "admin2@drop.local", model.RoleAdmin)
	second, err := svc.AcceptInvitation(ctx, token, "Segunda", "contraseña-larga")
	if err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}

	if _, err := svc.SetUserActive(ctx, second.ID, false, second.ID); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("disabling your own account should be refused, got %v", err)
	}
	if err := svc.DeleteUser(ctx, second.ID, second.ID); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("deleting your own account should be refused, got %v", err)
	}
}

func TestDeletedUsersFreeTheirEmail(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	if _, err := svc.Bootstrap(ctx, "admin@drop.local", "contraseña-larga"); err != nil {
		t.Fatalf("Bootstrap: %v", err)
	}
	users, _ := svc.ListUsers(ctx)
	admin := users[0]

	_, token := mustInvite(t, svc, "vuelve@drop.local", model.RoleUser)
	user, err := svc.AcceptInvitation(ctx, token, "Vuelve", "contraseña-larga")
	if err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}
	if err := svc.DeleteUser(ctx, user.ID, admin.ID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}

	// Soft delete keeps the row, so the unique index has to tolerate it or the
	// address would be burned forever.
	_, again := mustInvite(t, svc, "vuelve@drop.local", model.RoleUser)
	if _, err := svc.AcceptInvitation(ctx, again, "Otra vez", "contraseña-larga"); err != nil {
		t.Fatalf("the address should be reusable after a soft delete: %v", err)
	}
}
