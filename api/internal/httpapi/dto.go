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
