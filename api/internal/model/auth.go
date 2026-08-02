package model

import (
	"time"

	"gorm.io/gorm"
)

// Role is what a user is allowed to do. Only two exist for now; the column is
// a string rather than a bool so adding roles — and later a permission table
// keyed by role — does not mean migrating every row.
type Role string

const (
	RoleAdmin Role = "admin"
	RoleUser  Role = "user"
)

func (r Role) Valid() bool {
	switch r {
	case RoleAdmin, RoleUser:
		return true
	default:
		return false
	}
}

// User is someone who can sign in. There is no public sign-up: users exist
// because the bootstrap created them or because they accepted an invitation.
type User struct {
	ID uint `gorm:"primaryKey"`
	// Email is stored lowercased, and is the login identifier.
	//
	// The unique index spans DeletedAt so a soft-deleted user stops blocking
	// the address: SQL treats NULLs as distinct, so many deleted rows may share
	// an email while only one live row can hold it.
	Email        string         `gorm:"not null;size:320;uniqueIndex:idx_users_email"`
	DeletedAt    gorm.DeletedAt `gorm:"index;uniqueIndex:idx_users_email"`
	Name         string         `gorm:"size:255"`
	PasswordHash string         `gorm:"not null;size:255"`
	Role         Role           `gorm:"not null;size:32;index"`
	// OrganizationID is the tenant this account belongs to. Every account has
	// one, whether created by SetupInstance, Bootstrap (backfilled after by
	// BackfillOrganizations) or an accepted invitation.
	OrganizationID uint `gorm:"not null;index"`
	// Active is the reversible half of removing someone; DeletedAt is the
	// permanent-looking one. A deactivated user keeps their data and history.
	Active bool `gorm:"not null;default:true"`
	// LastLoginAt is nil until the first successful sign-in.
	LastLoginAt *time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

// Session is one signed-in device. The refresh token belongs to a session
// rather than to the user, which is what makes "sign out of this device" and
// "revoke every session" expressible, and leaves room for token rotation.
type Session struct {
	ID     uint `gorm:"primaryKey"`
	UserID uint `gorm:"not null;index"`
	// TokenHash is the SHA-256 of the refresh token. The token itself is never
	// stored: a leaked database must not hand out working sessions.
	//
	// A plain digest is right here, unlike for passwords — the token is
	// high-entropy random data, so there is nothing for a slow hash to defend
	// against.
	TokenHash string `gorm:"not null;size:64;uniqueIndex"`
	UserAgent string `gorm:"size:512"`
	IP        string `gorm:"size:64"`

	ExpiresAt  time.Time `gorm:"index"`
	LastUsedAt time.Time
	// RevokedAt marks a session ended before its token expired.
	RevokedAt *time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

// Active reports whether the session may still be used.
func (s *Session) Usable(now time.Time) bool {
	return s.RevokedAt == nil && now.Before(s.ExpiresAt)
}

// InvitationStatus is where an invitation is in its life.
type InvitationStatus string

const (
	InvitationPending  InvitationStatus = "pending"
	InvitationAccepted InvitationStatus = "accepted"
	InvitationExpired  InvitationStatus = "expired"
	InvitationRevoked  InvitationStatus = "revoked"
)

// Invitation is the only way an account comes into being. The admin creates
// one, hands the link over by whatever channel they like, and the recipient
// sets a password.
type Invitation struct {
	ID    uint   `gorm:"primaryKey"`
	Email string `gorm:"not null;size:320;index"`
	// TokenHash is the SHA-256 of the token in the invitation link; the link is
	// shown once, when the invitation is created, and cannot be recovered from
	// the database afterwards.
	TokenHash string `gorm:"not null;size:64;uniqueIndex"`
	Status    InvitationStatus `gorm:"not null;size:32;index"`
	// Role the invited user will be created with.
	Role Role `gorm:"not null;size:32"`

	ExpiresAt  time.Time `gorm:"index"`
	AcceptedAt *time.Time
	// CreatedByID is the admin who issued it, kept for the audit trail.
	CreatedByID uint `gorm:"index"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

// Expired reports whether a pending invitation has run out of time. The status
// column is only updated when something touches the row, so freshness is
// decided here rather than trusted from storage.
func (i *Invitation) Expired(now time.Time) bool {
	return now.After(i.ExpiresAt)
}
