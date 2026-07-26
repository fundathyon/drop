package httpapi

import (
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
