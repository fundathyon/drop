package httpapi

import (
	"time"

	"drop/internal/auth"
	"drop/internal/model"
	"drop/internal/service"
)

// ErrorResponse is the body returned for every non-2xx response. `code` is the
// stable machine-readable contract; `message` is for humans and may change.
type ErrorResponse struct {
	Code    string `json:"code" example:"not_found"`
	Message string `json:"message" example:"resource not found"`
}

type HealthResponse struct {
	Status string `json:"status" example:"ok"`
}

// ListResponse is a folder listing.
type ListResponse struct {
	Path     string         `json:"path" example:"proyectos"`
	Children []service.Node `json:"children"`
	// Access is what the caller may do with the listed folder itself — which
	// is what decides whether the admin offers to add to it or share it. A
	// drive's own root always reports owner.
	Access service.Access `json:"access" enums:"owner,editor,viewer" example:"owner"`
}

// UploadResponse reports the files stored by an upload.
type UploadResponse struct {
	Files []service.FileInfo `json:"files"`
}

// VersionsResponse is a drop's publication history, newest first.
type VersionsResponse struct {
	Path     string                `json:"path" example:"proyectos/arquitectura"`
	Versions []service.VersionInfo `json:"versions"`
}

// ActivateVersionRequest republishes an earlier version of a drop.
type ActivateVersionRequest struct {
	Seq uint `json:"seq" binding:"required" example:"2"`
}

// CreateFolderRequest creates a plain organizational folder.
type CreateFolderRequest struct {
	Parent string `json:"parent" example:"proyectos"`
	Name   string `json:"name" binding:"required" example:"clientes"`
}

// CreateDropRequest creates a drop under Parent.
type CreateDropRequest struct {
	Parent     string           `json:"parent" example:"proyectos"`
	Name       string           `json:"name" binding:"required" example:"arquitectura"`
	Title      string           `json:"title" example:"Arquitectura del sistema"`
	Visibility model.Visibility `json:"visibility" enums:"public,unlisted,private" example:"public"`
	Entrypoint string           `json:"entrypoint" example:"index.html"`
}

// PatchDropRequest updates a drop's metadata. Omitted fields are left as-is.
type PatchDropRequest struct {
	Title      *string           `json:"title" example:"Arquitectura v2"`
	Visibility *model.Visibility `json:"visibility" enums:"public,unlisted,private" example:"unlisted"`
	Entrypoint *string           `json:"entrypoint" example:"index.html"`
}

// LoginRequest opens a session for an API client.
type LoginRequest struct {
	Email    string `json:"email" binding:"required" example:"admin@drop.local"`
	Password string `json:"password" binding:"required" example:"admin"`
}

// RefreshRequest buys a new access token.
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// TokenResponse is what login and refresh return.
//
// Unlike the admin, which keeps its refresh token in an HttpOnly cookie it
// never reads, an API client is handed both tokens: it has nowhere else to
// keep one, and no browser to be attacked through.
type TokenResponse struct {
	AccessToken  string        `json:"access_token"`
	TokenType    string        `json:"token_type" example:"Bearer"`
	ExpiresAt    time.Time     `json:"expires_at"`
	RefreshToken string        `json:"refresh_token"`
	RefreshUntil time.Time     `json:"refresh_expires_at"`
	User         auth.UserInfo `json:"user"`
}

// UsersResponse lists the accounts that exist.
type UsersResponse struct {
	Users []auth.UserInfo `json:"users"`
}

// InvitationsResponse lists invitations, newest first.
type InvitationsResponse struct {
	Invitations []auth.InvitationInfo `json:"invitations"`
}

// CreateInvitationRequest issues a single-use invitation link.
type CreateInvitationRequest struct {
	Email string     `json:"email" binding:"required" example:"nuevo@ejemplo.com"`
	Role  model.Role `json:"role" enums:"admin,user" example:"user"`
}

// CreateInvitationResponse carries the only copy of the token there will ever
// be: storage keeps just its hash, so a lost link is reissued, never recovered.
type CreateInvitationResponse struct {
	Invitation auth.InvitationInfo `json:"invitation"`
	Token      string              `json:"token"`
	// URL is the link to hand over. No email is sent in this version.
	URL string `json:"url" example:"http://localhost:8000/invitacion?token=…"`
}

// SetUserActiveRequest disables or re-enables an account.
type SetUserActiveRequest struct {
	Active *bool `json:"active" binding:"required" example:"false"`
}

// ShareRequest grants or updates a user's access to the node named by the
// `path`/`owner` query parameters.
type ShareRequest struct {
	UserID uint         `json:"user_id" binding:"required" example:"2"`
	Access model.Access `json:"access" binding:"required" enums:"viewer,editor" example:"viewer"`
}

// ShareListResponse is who already has access to a node, and who could still
// be given some — the same filter (excludes the owner and disabled accounts)
// the admin UI applies before offering a share dialog.
type ShareListResponse struct {
	Path       string              `json:"path" example:"proyectos/arquitectura"`
	Shares     []service.ShareInfo `json:"shares"`
	Candidates []auth.UserInfo     `json:"candidates"`
}

// SharedResponse is what other people have granted the caller, across every
// drive — one-directional, and never includes the caller's own grants to
// others.
type SharedResponse struct {
	Nodes []service.SharedNode `json:"nodes"`
}

// SetupStatusResponse reports whether this instance still needs its first
// administrator.
type SetupStatusResponse struct {
	NeedsSetup bool `json:"needs_setup" example:"true"`
}

// SetupRequest creates the organization and its first administrator. It is
// the one request an empty instance accepts.
type SetupRequest struct {
	OrgName         string `json:"org_name" binding:"required" example:"Acme"`
	Name            string `json:"name" example:"Rafa"`
	Email           string `json:"email" binding:"required" example:"admin@drop.local"`
	Password        string `json:"password" binding:"required"`
	PasswordConfirm string `json:"password_confirm" binding:"required"`
}

// AcceptInvitationRequest creates the account behind a pending invitation.
// The invitation itself carries the address, so there is nothing here for the
// recipient to mistype into someone else's invitation.
type AcceptInvitationRequest struct {
	Token           string `json:"token" binding:"required"`
	Name            string `json:"name" example:"Rafa"`
	Password        string `json:"password" binding:"required"`
	PasswordConfirm string `json:"password_confirm" binding:"required"`
}
