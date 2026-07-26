package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"

	"drop/internal/model"
)

var (
	// ErrInvalidCredentials is returned for a wrong password, an unknown email
	// and a malformed one alike. Distinguishing them would turn the login form
	// into a way to enumerate who has an account.
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountDisabled    = errors.New("account is disabled")
	ErrNotFound           = errors.New("not found")
	ErrExists             = errors.New("already exists")
	ErrInvalidInvitation  = errors.New("invitation is not usable")
	ErrInvalidInput       = errors.New("invalid input")
	// ErrLastAdmin stops the last administrator from being removed, which
	// would leave nobody able to invite anyone back in.
	ErrLastAdmin = errors.New("this is the last active administrator")
)

// MinPasswordLength is deliberately a floor, not a composition rule: length is
// what makes a password hard to guess, and character-class rules mostly push
// people towards predictable substitutions.
const MinPasswordLength = 8

// Service is the application logic for accounts, sessions and invitations.
type Service struct {
	db     *gorm.DB
	issuer *Issuer
	// invitationTTL is how long a fresh invitation stays usable.
	invitationTTL time.Duration
}

func NewService(db *gorm.DB, issuer *Issuer, invitationTTL time.Duration) *Service {
	return &Service{db: db, issuer: issuer, invitationTTL: invitationTTL}
}

// ---------- representations ----------

// Tokens is what a successful login or refresh returns.
type Tokens struct {
	AccessToken  string    `json:"access_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	RefreshToken string    `json:"-"`
	RefreshUntil time.Time `json:"-"`
}

// Device is what is known about the client asking for a session, kept so a
// user can recognize their own sessions later.
type Device struct {
	UserAgent string
	IP        string
}

// UserInfo is a user as the API reports one. It never carries the hash.
type UserInfo struct {
	ID          uint       `json:"id" example:"1"`
	Email       string     `json:"email" example:"admin@drop.local"`
	Name        string     `json:"name" example:"Admin"`
	Role        model.Role `json:"role" enums:"admin,user" example:"admin"`
	Active      bool       `json:"active" example:"true"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func userInfo(u *model.User) UserInfo {
	return UserInfo{
		ID:          u.ID,
		Email:       u.Email,
		Name:        u.Name,
		Role:        u.Role,
		Active:      u.Active,
		LastLoginAt: u.LastLoginAt,
		CreatedAt:   u.CreatedAt.UTC(),
	}
}

// InvitationInfo is an invitation as the API reports one. The token is only
// ever present on the response that created it.
type InvitationInfo struct {
	ID         uint                   `json:"id" example:"1"`
	Email      string                 `json:"email" example:"nuevo@ejemplo.com"`
	Role       model.Role             `json:"role" enums:"admin,user" example:"user"`
	Status     model.InvitationStatus `json:"status" enums:"pending,accepted,expired,revoked" example:"pending"`
	ExpiresAt  time.Time              `json:"expires_at"`
	AcceptedAt *time.Time             `json:"accepted_at,omitempty"`
	CreatedAt  time.Time              `json:"created_at"`
}

func invitationInfo(i *model.Invitation, now time.Time) InvitationInfo {
	status := i.Status
	// Expiry is a function of the clock, so a pending invitation past its date
	// reports as expired even before anything rewrites the row.
	if status == model.InvitationPending && i.Expired(now) {
		status = model.InvitationExpired
	}
	return InvitationInfo{
		ID:         i.ID,
		Email:      i.Email,
		Role:       i.Role,
		Status:     status,
		ExpiresAt:  i.ExpiresAt.UTC(),
		AcceptedAt: i.AcceptedAt,
		CreatedAt:  i.CreatedAt.UTC(),
	}
}

// ---------- bootstrap ----------

// Bootstrap makes sure an administrator exists. It creates one from the
// configured credentials when the table has none, and leaves any existing
// account exactly as it is — including its password, which may well have been
// changed away from the configured default on purpose.
func (s *Service) Bootstrap(ctx context.Context, email, password string) (UserInfo, error) {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return UserInfo{}, fmt.Errorf("%w: ADMIN_EMAIL and ADMIN_PASSWORD are required", ErrInvalidInput)
	}

	var existing model.User
	err := s.db.WithContext(ctx).Where("email = ?", email).First(&existing).Error
	if err == nil {
		slog.Info("administrator already exists", "email", email)
		return userInfo(&existing), nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return UserInfo{}, err
	}

	hash, err := HashPassword(password)
	if err != nil {
		return UserInfo{}, err
	}
	admin := model.User{
		Email:        email,
		Name:         "Admin",
		PasswordHash: hash,
		Role:         model.RoleAdmin,
		Active:       true,
	}
	if err := s.db.WithContext(ctx).Create(&admin).Error; err != nil {
		return UserInfo{}, err
	}

	slog.Warn("created the bootstrap administrator; change this password",
		"email", email)
	return userInfo(&admin), nil
}

// ---------- sessions ----------

// Login verifies credentials and opens a session.
func (s *Service) Login(ctx context.Context, email, password string, device Device) (Tokens, UserInfo, error) {
	var user model.User
	err := s.db.WithContext(ctx).Where("email = ?", normalizeEmail(email)).First(&user).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Hash anyway. Returning early on an unknown address makes the response
		// measurably faster than a wrong password, which is enough to tell the
		// two apart and enumerate accounts.
		_, _ = HashPassword(password)
		return Tokens{}, UserInfo{}, ErrInvalidCredentials
	}
	if err != nil {
		return Tokens{}, UserInfo{}, err
	}

	if err := VerifyPassword(password, user.PasswordHash); err != nil {
		return Tokens{}, UserInfo{}, ErrInvalidCredentials
	}
	// Only said once the password checked out: before that it would reveal
	// which addresses have accounts.
	if !user.Active {
		return Tokens{}, UserInfo{}, ErrAccountDisabled
	}

	tokens, err := s.openSession(ctx, &user, device)
	if err != nil {
		return Tokens{}, UserInfo{}, err
	}

	now := time.Now().UTC()
	user.LastLoginAt = &now
	if err := s.db.WithContext(ctx).Model(&user).Update("last_login_at", now).Error; err != nil {
		return Tokens{}, UserInfo{}, err
	}

	slog.Info("login", "user_id", user.ID, "email", user.Email, "ip", device.IP)
	return tokens, userInfo(&user), nil
}

// openSession issues the pair and records the session the refresh token
// belongs to.
func (s *Service) openSession(ctx context.Context, user *model.User, device Device) (Tokens, error) {
	now := time.Now().UTC()
	session := model.Session{
		UserID:     user.ID,
		UserAgent:  truncate(device.UserAgent, 512),
		IP:         truncate(device.IP, 64),
		ExpiresAt:  now.Add(s.issuer.RefreshTTL()),
		LastUsedAt: now,
		// Filled in below: the token cannot be signed before the row has an id,
		// and the row cannot be stored without the token's hash. A placeholder
		// keeps the unique index happy for the moment in between.
		TokenHash: "",
	}
	placeholder, err := NewSecret()
	if err != nil {
		return Tokens{}, err
	}
	session.TokenHash = hashToken(placeholder)

	if err := s.db.WithContext(ctx).Create(&session).Error; err != nil {
		return Tokens{}, err
	}

	refresh, refreshUntil, err := s.issuer.Refresh(user.ID, session.ID)
	if err != nil {
		return Tokens{}, err
	}
	if err := s.db.WithContext(ctx).Model(&session).
		Update("token_hash", hashToken(refresh)).Error; err != nil {
		return Tokens{}, err
	}

	access, accessUntil, err := s.issuer.Access(user.ID, string(user.Role))
	if err != nil {
		return Tokens{}, err
	}

	return Tokens{
		AccessToken:  access,
		ExpiresAt:    accessUntil,
		RefreshToken: refresh,
		RefreshUntil: refreshUntil,
	}, nil
}

// resolveSession validates a refresh token against the session it was issued
// for and the account behind it. Both Refresh and SessionUser go through it, so
// a revoked session and a disabled account are rejected the same way whether
// the caller is an API client or a browser.
func (s *Service) resolveSession(ctx context.Context, refreshToken string) (*model.Session, *model.User, error) {
	claims, err := s.issuer.Verify(refreshToken, KindRefresh)
	if err != nil {
		return nil, nil, ErrInvalidCredentials
	}

	var session model.Session
	// Looked up by hash rather than by the id in the token: a token whose
	// session was revoked must not resurrect it, and the hash is what proves
	// this is the token the session was opened with.
	err = s.db.WithContext(ctx).
		Where("id = ? AND token_hash = ?", claims.SessionID, hashToken(refreshToken)).
		First(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, nil, err
	}
	if !session.Usable(time.Now().UTC()) {
		return nil, nil, ErrInvalidCredentials
	}

	var user model.User
	if err := s.db.WithContext(ctx).First(&user, session.UserID).Error; err != nil {
		return nil, nil, ErrInvalidCredentials
	}
	// Deactivating someone has to take effect before their access token would
	// have expired, which means checking here rather than trusting the token.
	if !user.Active {
		return nil, nil, ErrAccountDisabled
	}
	return &session, &user, nil
}

// SessionUser resolves who is behind a refresh token, without minting anything.
//
// It exists for the server-rendered admin, which keeps the refresh token in a
// cookie and authorizes each page from it directly. Going through Refresh
// instead would sign an access token on every page view that nothing would ever
// read.
func (s *Service) SessionUser(ctx context.Context, refreshToken string) (UserInfo, error) {
	session, user, err := s.resolveSession(ctx, refreshToken)
	if err != nil {
		return UserInfo{}, err
	}
	if err := s.db.WithContext(ctx).Model(session).
		Update("last_used_at", time.Now().UTC()).Error; err != nil {
		return UserInfo{}, err
	}
	return userInfo(user), nil
}

// Refresh exchanges a valid refresh token for a new access token. The refresh
// token itself is left in place; rotating it is the next step this shape was
// chosen to allow, not something today's clients expect.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Tokens, UserInfo, error) {
	session, user, err := s.resolveSession(ctx, refreshToken)
	if err != nil {
		return Tokens{}, UserInfo{}, err
	}

	access, expires, err := s.issuer.Access(user.ID, string(user.Role))
	if err != nil {
		return Tokens{}, UserInfo{}, err
	}
	if err := s.db.WithContext(ctx).Model(session).
		Update("last_used_at", time.Now().UTC()).Error; err != nil {
		return Tokens{}, UserInfo{}, err
	}

	return Tokens{
		AccessToken:  access,
		ExpiresAt:    expires,
		RefreshToken: refreshToken,
		RefreshUntil: session.ExpiresAt,
	}, userInfo(user), nil
}

// UserFromAccessToken authorizes an API call from a bearer token.
//
// The token carries the role, so this could answer without touching the
// database. It reads the row anyway: an access token stays valid for its whole
// lifetime, and without this check a disabled account would keep working until
// it expired. One indexed lookup against a local database is a cheaper price
// than that window.
func (s *Service) UserFromAccessToken(ctx context.Context, token string) (UserInfo, error) {
	claims, err := s.issuer.Verify(token, KindAccess)
	if err != nil {
		return UserInfo{}, ErrInvalidCredentials
	}
	id, err := claims.UserID()
	if err != nil {
		return UserInfo{}, ErrInvalidCredentials
	}

	user, err := s.userByID(ctx, id)
	if err != nil {
		return UserInfo{}, ErrInvalidCredentials
	}
	if !user.Active {
		return UserInfo{}, ErrAccountDisabled
	}
	return userInfo(user), nil
}

// Logout revokes the session behind a refresh token. It is deliberately quiet
// about tokens it does not recognize: signing out is not a place to learn
// whether a token was real.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Model(&model.Session{}).
		Where("token_hash = ? AND revoked_at IS NULL", hashToken(refreshToken)).
		Update("revoked_at", now).Error
}

// revokeSessions ends every session a user has, used when an account is
// disabled or removed so existing refresh tokens stop working at once.
func (s *Service) revokeSessions(ctx context.Context, userID uint) error {
	return s.db.WithContext(ctx).Model(&model.Session{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", time.Now().UTC()).Error
}

// ---------- users ----------

func (s *Service) UserByID(ctx context.Context, id uint) (UserInfo, error) {
	user, err := s.userByID(ctx, id)
	if err != nil {
		return UserInfo{}, err
	}
	return userInfo(user), nil
}

func (s *Service) userByID(ctx context.Context, id uint) (*model.User, error) {
	var user model.User
	err := s.db.WithContext(ctx).First(&user, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// ListUsers returns every account that has not been deleted.
func (s *Service) ListUsers(ctx context.Context) ([]UserInfo, error) {
	var users []model.User
	if err := s.db.WithContext(ctx).Order("created_at").Find(&users).Error; err != nil {
		return nil, err
	}
	out := make([]UserInfo, 0, len(users))
	for i := range users {
		out = append(out, userInfo(&users[i]))
	}
	return out, nil
}

// SetUserActive disables or re-enables an account. Disabling also ends the
// user's sessions, so it takes effect immediately rather than whenever their
// access token happens to expire.
func (s *Service) SetUserActive(ctx context.Context, id uint, active bool, actingUserID uint) (UserInfo, error) {
	user, err := s.userByID(ctx, id)
	if err != nil {
		return UserInfo{}, err
	}
	if !active {
		if user.ID == actingUserID {
			return UserInfo{}, fmt.Errorf("%w: you cannot disable your own account", ErrInvalidInput)
		}
		if err := s.guardLastAdmin(ctx, user); err != nil {
			return UserInfo{}, err
		}
	}

	if err := s.db.WithContext(ctx).Model(user).Update("active", active).Error; err != nil {
		return UserInfo{}, err
	}
	user.Active = active

	if !active {
		if err := s.revokeSessions(ctx, user.ID); err != nil {
			return UserInfo{}, err
		}
	}
	slog.Info("user activity changed", "user_id", user.ID, "active", active, "by", actingUserID)
	return userInfo(user), nil
}

// DeleteUser soft-deletes an account, so anything that referenced it still
// resolves, and ends its sessions.
func (s *Service) DeleteUser(ctx context.Context, id, actingUserID uint) error {
	user, err := s.userByID(ctx, id)
	if err != nil {
		return err
	}
	if user.ID == actingUserID {
		return fmt.Errorf("%w: you cannot delete your own account", ErrInvalidInput)
	}
	if err := s.guardLastAdmin(ctx, user); err != nil {
		return err
	}

	if err := s.revokeSessions(ctx, user.ID); err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Delete(user).Error; err != nil {
		return err
	}
	slog.Info("user deleted", "user_id", user.ID, "by", actingUserID)
	return nil
}

// guardLastAdmin refuses to remove the only administrator left, which would
// lock everyone out of inviting anyone back.
func (s *Service) guardLastAdmin(ctx context.Context, user *model.User) error {
	if user.Role != model.RoleAdmin || !user.Active {
		return nil
	}
	var others int64
	if err := s.db.WithContext(ctx).Model(&model.User{}).
		Where("role = ? AND active = ? AND id <> ?", model.RoleAdmin, true, user.ID).
		Count(&others).Error; err != nil {
		return err
	}
	if others == 0 {
		return ErrLastAdmin
	}
	return nil
}

// ---------- invitations ----------

// CreateInvitation issues a single-use link. The token is returned once, here,
// and only its hash is stored — so a lost link is reissued, never recovered.
func (s *Service) CreateInvitation(ctx context.Context, email string, role model.Role, createdBy uint) (InvitationInfo, string, error) {
	email = normalizeEmail(email)
	if !validEmail(email) {
		return InvitationInfo{}, "", fmt.Errorf("%w: a valid email is required", ErrInvalidInput)
	}
	if role == "" {
		role = model.RoleUser
	}
	if !role.Valid() {
		return InvitationInfo{}, "", fmt.Errorf("%w: unknown role %q", ErrInvalidInput, role)
	}

	var taken int64
	if err := s.db.WithContext(ctx).Model(&model.User{}).
		Where("email = ?", email).Count(&taken).Error; err != nil {
		return InvitationInfo{}, "", err
	}
	if taken > 0 {
		return InvitationInfo{}, "", fmt.Errorf("%w: %s already has an account", ErrExists, email)
	}

	token, err := NewSecret()
	if err != nil {
		return InvitationInfo{}, "", err
	}

	now := time.Now().UTC()
	invitation := model.Invitation{
		Email:       email,
		TokenHash:   hashToken(token),
		Status:      model.InvitationPending,
		Role:        role,
		ExpiresAt:   now.Add(s.invitationTTL),
		CreatedByID: createdBy,
	}

	// Any earlier pending invitation for the same address is superseded, so a
	// reissued link is the only one that works.
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Invitation{}).
			Where("email = ? AND status = ?", email, model.InvitationPending).
			Update("status", model.InvitationRevoked).Error; err != nil {
			return err
		}
		return tx.Create(&invitation).Error
	}); err != nil {
		return InvitationInfo{}, "", err
	}

	slog.Info("invitation created", "email", email, "role", role, "by", createdBy)
	return invitationInfo(&invitation, now), token, nil
}

func (s *Service) ListInvitations(ctx context.Context) ([]InvitationInfo, error) {
	var invitations []model.Invitation
	if err := s.db.WithContext(ctx).Order("created_at DESC").Find(&invitations).Error; err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	out := make([]InvitationInfo, 0, len(invitations))
	for i := range invitations {
		out = append(out, invitationInfo(&invitations[i], now))
	}
	return out, nil
}

// RevokeInvitation cancels a pending invitation.
func (s *Service) RevokeInvitation(ctx context.Context, id uint) (InvitationInfo, error) {
	var invitation model.Invitation
	err := s.db.WithContext(ctx).First(&invitation, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return InvitationInfo{}, ErrNotFound
	}
	if err != nil {
		return InvitationInfo{}, err
	}
	if invitation.Status != model.InvitationPending {
		return InvitationInfo{}, fmt.Errorf("%w: it is already %s", ErrInvalidInvitation, invitation.Status)
	}

	invitation.Status = model.InvitationRevoked
	if err := s.db.WithContext(ctx).Model(&invitation).
		Update("status", model.InvitationRevoked).Error; err != nil {
		return InvitationInfo{}, err
	}
	return invitationInfo(&invitation, time.Now().UTC()), nil
}

// InvitationByToken resolves a link so the acceptance page can decide what to
// show before asking for a password.
func (s *Service) InvitationByToken(ctx context.Context, token string) (InvitationInfo, error) {
	invitation, err := s.pendingInvitation(ctx, token)
	if err != nil {
		return InvitationInfo{}, err
	}
	return invitationInfo(invitation, time.Now().UTC()), nil
}

// pendingInvitation finds a usable invitation, marking it expired if its time
// has passed so the state in storage catches up with the clock.
func (s *Service) pendingInvitation(ctx context.Context, token string) (*model.Invitation, error) {
	if token == "" {
		return nil, ErrInvalidInvitation
	}

	var invitation model.Invitation
	err := s.db.WithContext(ctx).Where("token_hash = ?", hashToken(token)).First(&invitation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrInvalidInvitation
	}
	if err != nil {
		return nil, err
	}

	if invitation.Status != model.InvitationPending {
		return nil, fmt.Errorf("%w: it is %s", ErrInvalidInvitation, invitation.Status)
	}
	if invitation.Expired(time.Now().UTC()) {
		if err := s.db.WithContext(ctx).Model(&invitation).
			Update("status", model.InvitationExpired).Error; err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("%w: it expired", ErrInvalidInvitation)
	}
	return &invitation, nil
}

// AcceptInvitation creates the account behind a pending invitation. The
// invitation carries the address, so the form only asks for a name and a
// password — there is nothing for the recipient to mistype into someone else's
// invitation.
func (s *Service) AcceptInvitation(ctx context.Context, token, name, password string) (UserInfo, error) {
	if len([]rune(password)) < MinPasswordLength {
		return UserInfo{}, fmt.Errorf("%w: the password must be at least %d characters",
			ErrInvalidInput, MinPasswordLength)
	}

	invitation, err := s.pendingInvitation(ctx, token)
	if err != nil {
		return UserInfo{}, err
	}

	hash, err := HashPassword(password)
	if err != nil {
		return UserInfo{}, err
	}

	name = strings.TrimSpace(name)
	if name == "" {
		name, _, _ = strings.Cut(invitation.Email, "@")
	}

	user := model.User{
		Email:        invitation.Email,
		Name:         name,
		PasswordHash: hash,
		Role:         invitation.Role,
		Active:       true,
	}

	now := time.Now().UTC()
	// One transaction: an account created without its invitation being closed
	// would leave the link working for a second person.
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		return tx.Model(invitation).Updates(map[string]any{
			"status":      model.InvitationAccepted,
			"accepted_at": now,
		}).Error
	}); err != nil {
		return UserInfo{}, err
	}

	slog.Info("invitation accepted", "email", user.Email, "user_id", user.ID)
	return userInfo(&user), nil
}

// ---------- helpers ----------

// hashToken digests a token for storage. SHA-256 is the right tool here: the
// input is already 256 bits of randomness, so there is no guessing to slow down.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// validEmail is a shape check, not a proof of deliverability — which only
// sending to it can establish, and this version does not send anything.
func validEmail(email string) bool {
	at := strings.IndexByte(email, '@')
	if at <= 0 || at == len(email)-1 || len(email) > 320 {
		return false
	}
	domain := email[at+1:]
	return strings.Contains(domain, ".") && !strings.ContainsAny(email, " \t\n\r")
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
