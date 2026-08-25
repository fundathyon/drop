package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	// ErrInvalidToken covers every reason a token was not accepted. The caller
	// gets one error on purpose: telling a client whether a token was expired,
	// forged or of the wrong kind tells an attacker the same thing.
	ErrInvalidToken = errors.New("invalid token")
)

// Kind separates the two tokens. Without it, a refresh token — which lives for
// weeks — would be accepted anywhere an access token is, and the short access
// lifetime would buy nothing.
type Kind string

const (
	KindAccess  Kind = "access"
	KindRefresh Kind = "refresh"
)

// Claims is the payload carried by both tokens.
type Claims struct {
	jwt.RegisteredClaims
	// Kind is "access" or "refresh".
	Kind Kind `json:"typ"`
	// Role is denormalized into the access token so authorizing a request does
	// not need a database round trip.
	Role string `json:"role,omitempty"`
	// SessionID ties a refresh token to the session it was issued for, so the
	// session can be revoked without waiting for the token to expire.
	SessionID uint `json:"sid,omitempty"`
}

// Issuer signs and verifies tokens.
type Issuer struct {
	keys       *Keys
	issuer     string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewIssuer(keys *Keys, issuer string, accessTTL, refreshTTL time.Duration) *Issuer {
	return &Issuer{keys: keys, issuer: issuer, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

func (i *Issuer) AccessTTL() time.Duration  { return i.accessTTL }
func (i *Issuer) RefreshTTL() time.Duration { return i.refreshTTL }

// Access mints a short-lived token that authorizes API calls.
func (i *Issuer) Access(userID uint, role string) (string, time.Time, error) {
	return i.sign(Claims{Kind: KindAccess, Role: role}, userID, i.accessTTL)
}

// Refresh mints the long-lived token that buys new access tokens.
func (i *Issuer) Refresh(userID, sessionID uint) (string, time.Time, error) {
	return i.sign(Claims{Kind: KindRefresh, SessionID: sessionID}, userID, i.refreshTTL)
}

func (i *Issuer) sign(claims Claims, userID uint, ttl time.Duration) (string, time.Time, error) {
	now := time.Now().UTC()
	expires := now.Add(ttl)

	id, err := randomID()
	if err != nil {
		return "", time.Time{}, err
	}

	claims.RegisteredClaims = jwt.RegisteredClaims{
		Subject:   fmt.Sprint(userID),
		Issuer:    i.issuer,
		ID:        id,
		IssuedAt:  jwt.NewNumericDate(now),
		NotBefore: jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expires),
	}

	signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(i.keys.Private)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign token: %w", err)
	}
	return signed, expires, nil
}

// Verify parses a token and checks it is of the expected kind.
func (i *Issuer) Verify(token string, want Kind) (*Claims, error) {
	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims,
		func(*jwt.Token) (any, error) { return i.keys.Public, nil },
		// Pinning the algorithm is what stops the classic confusion attacks: a
		// token re-signed with "none", or with HS256 using the public key as
		// the shared secret, must not even reach validation.
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithIssuer(i.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !parsed.Valid {
		return nil, ErrInvalidToken
	}
	if claims.Kind != want {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// UserID reads the subject back as the id it was written from.
func (c *Claims) UserID() (uint, error) {
	var id uint
	if _, err := fmt.Sscanf(c.Subject, "%d", &id); err != nil || id == 0 {
		return 0, ErrInvalidToken
	}
	return id, nil
}

// randomID gives every token a unique jti, so individual tokens can be denied
// later without changing the format.
func randomID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// NewSecret returns a URL-safe random string for invitations and for the
// opaque half of a refresh token.
func NewSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
