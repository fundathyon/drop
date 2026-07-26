package httpapi

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"drop/internal/model"
	"drop/internal/service"
)

type handler struct {
	svc *service.Service
}

// Health godoc
//
//	@Summary		Liveness probe
//	@Description	Returns ok when the API process is up.
//	@Tags			operation
//	@Produce		json
//	@Success		200	{object}	HealthResponse
//	@Router			/healthz [get]
func (h *handler) health(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{Status: "ok"})
}

// ListNodes godoc
//
//	@Summary		List folders and drops
//	@Description	Lists the direct children of a folder. An empty path lists the root. Returns 409 `is_drop` when the path is a drop — fetch it via /v1/drops instead.
//	@Tags			nodes
//	@Produce		json
//	@Param			path	query		string	false	"Folder path; empty means the root"	example(proyectos)
//	@Success		200		{object}	ListResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Router			/v1/nodes [get]
func (h *handler) listNodes(c *gin.Context) {
	path := c.Query("path")
	nodes, err := h.svc.List(c.Request.Context(), path)
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, ListResponse{Path: path, Children: nodes})
}

// CreateFolder godoc
//
//	@Summary		Create a folder
//	@Description	Creates a plain organizational folder inside another folder.
//	@Tags			nodes
//	@Accept			json
//	@Produce		json
//	@Param			body	body		CreateFolderRequest	true	"Folder to create"
//	@Success		201		{object}	service.Node
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Router			/v1/nodes [post]
func (h *handler) createFolder(c *gin.Context) {
	var req CreateFolderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "name is required")
		return
	}
	node, err := h.svc.CreateFolder(c.Request.Context(), req.Parent, req.Name)
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, node)
}

// DeleteNode godoc
//
//	@Summary		Delete a folder or drop
//	@Description	Deletes the node and everything beneath it, including the stored files of every drop in the subtree.
//	@Tags			nodes
//	@Produce		json
//	@Param			path	query	string	true	"Path of the node to delete"	example(proyectos/arquitectura)
//	@Success		204		"deleted"
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Router			/v1/nodes [delete]
func (h *handler) deleteNode(c *gin.Context) {
	path := c.Query("path")
	if strings.TrimSpace(path) == "" {
		abortWithError(c, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	if err := h.svc.Delete(c.Request.Context(), path); err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// GetDrop godoc
//
//	@Summary		Get a drop
//	@Description	Returns a drop's metadata and the files it is composed of.
//	@Tags			drops
//	@Produce		json
//	@Param			path	query		string	true	"Drop path"	example(proyectos/arquitectura)
//	@Success		200		{object}	service.DropDetail
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		422		{object}	ErrorResponse
//	@Router			/v1/drops [get]
func (h *handler) getDrop(c *gin.Context) {
	detail, err := h.svc.GetDrop(c.Request.Context(), c.Query("path"))
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

// CreateDrop godoc
//
//	@Summary		Create a drop
//	@Description	Creates a drop: a node carrying metadata plus a materialized `.drop` YAML descriptor in object storage.
//	@Tags			drops
//	@Accept			json
//	@Produce		json
//	@Param			body	body		CreateDropRequest	true	"Drop to create"
//	@Success		201		{object}	service.DropDetail
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Router			/v1/drops [post]
func (h *handler) createDrop(c *gin.Context) {
	var req CreateDropRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "name is required")
		return
	}
	detail, err := h.svc.CreateDrop(c.Request.Context(), service.DropInput{
		Parent:     req.Parent,
		Name:       req.Name,
		Title:      req.Title,
		Visibility: req.Visibility,
		Entrypoint: req.Entrypoint,
	})
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, detail)
}

// UploadDrop godoc
//
//	@Summary		Create a drop with its files
//	@Description	Creates a drop and uploads its files in a single multipart request. Repeat the `file` field once per file. To place files in subdirectories, repeat a `path` field as well — the Nth `path` names the Nth `file` — because RFC 7578 forbids directory information in a part's filename. Everything is validated before any byte is stored, and a failed upload rolls the whole drop back.
//	@Tags			drops
//	@Accept			mpfd
//	@Produce		json
//	@Param			title		formData	string	true	"Drop title"						example(Arquitectura del sistema)
//	@Param			file		formData	file	true	"File(s) that compose the drop"
//	@Param			path		formData	string	false	"Relative path for each file, in the same order as `file`"	example(assets/app.css)
//	@Param			entrypoint	formData	string	false	"Page to open. Inferred when omitted: the only HTML uploaded, whatever its name, or index.html when there are several"	example(index.html)
//	@Param			visibility	formData	string	false	"public (default), unlisted or private"						Enums(public, unlisted, private)
//	@Param			parent		formData	string	false	"Destination folder; defaults to the root"					example(Proyectos)
//	@Param			name		formData	string	false	"Folder name; defaults to a slug of the title"				example(arquitectura)
//	@Success		201			{object}	service.DropDetail
//	@Failure		400			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Failure		409			{object}	ErrorResponse
//	@Failure		422			{object}	ErrorResponse
//	@Router			/v1/drops/upload [post]
func (h *handler) uploadDrop(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "expected multipart/form-data")
		return
	}
	defer func() { _ = form.RemoveAll() }()

	title := strings.TrimSpace(firstValue(form.Value["title"]))
	if title == "" {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "title is required")
		return
	}

	headers := form.File["file"]
	if len(headers) == 0 {
		abortWithError(c, http.StatusBadRequest, "invalid_body", `at least one file is required under the "file" field`)
		return
	}

	// RFC 7578 §4.2 forbids directory information in a part's filename, and Go
	// enforces it with filepath.Base — so a subdirectory can only be expressed
	// through a companion `path` field, matched to `file` by position.
	paths := form.Value["path"]
	if len(paths) > 0 && len(paths) != len(headers) {
		abortWithError(c, http.StatusBadRequest, "invalid_body",
			"send one `path` per `file`, in the same order, or none at all")
		return
	}

	files := make([]service.UploadFile, 0, len(headers))
	for i, fh := range headers {
		relPath := fh.Filename
		if len(paths) > 0 {
			relPath = paths[i]
		}
		files = append(files, service.UploadFile{
			Path:        relPath,
			ContentType: fh.Header.Get("Content-Type"),
			Size:        fh.Size,
			Open:        func() (io.ReadCloser, error) { return fh.Open() },
		})
	}

	detail, err := h.svc.UploadDrop(c.Request.Context(), service.UploadDropInput{
		Parent:     firstValue(form.Value["parent"]),
		Name:       firstValue(form.Value["name"]),
		Title:      title,
		Entrypoint: firstValue(form.Value["entrypoint"]),
		Visibility: model.Visibility(firstValue(form.Value["visibility"])),
		Files:      files,
	})
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, detail)
}

func firstValue(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

// PatchDrop godoc
//
//	@Summary		Update drop metadata
//	@Description	Patches title, visibility, or entrypoint and refreshes the drop's `.drop` descriptor.
//	@Tags			drops
//	@Accept			json
//	@Produce		json
//	@Param			path	query		string				true	"Drop path"	example(proyectos/arquitectura)
//	@Param			body	body		PatchDropRequest	true	"Fields to update"
//	@Success		200		{object}	service.DropDetail
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		422		{object}	ErrorResponse
//	@Router			/v1/drops [patch]
func (h *handler) patchDrop(c *gin.Context) {
	var req PatchDropRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	detail, err := h.svc.UpdateDropMeta(c.Request.Context(), c.Query("path"), service.DropPatch{
		Title:      req.Title,
		Visibility: req.Visibility,
		Entrypoint: req.Entrypoint,
	})
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

// DownloadFile godoc
//
//	@Summary		Download a file
//	@Description	Streams a file stored inside a drop.
//	@Tags			files
//	@Produce		octet-stream
//	@Param			path	query	string	true	"Full path of the file"	example(proyectos/arquitectura/index.html)
//	@Success		200		{file}		binary
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Router			/v1/files [get]
func (h *handler) downloadFile(c *gin.Context) {
	body, info, err := h.svc.OpenFile(c.Request.Context(), c.Query("path"))
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	defer body.Close()

	contentType := info.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.DataFromReader(http.StatusOK, info.Size, contentType, body, nil)
}

// UploadFiles godoc
//
//	@Summary		Upload files to a drop
//	@Description	Stores one or more files inside a drop. Send them as multipart/form-data under the `file` field; an existing file of the same name is replaced.
//	@Tags			files
//	@Accept			mpfd
//	@Produce		json
//	@Param			path	query		string	true	"Drop path"	example(proyectos/arquitectura)
//	@Param			file	formData	file	true	"File(s) to upload"
//	@Success		201		{object}	UploadResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		422		{object}	ErrorResponse
//	@Router			/v1/files [post]
func (h *handler) uploadFiles(c *gin.Context) {
	path := c.Query("path")

	form, err := c.MultipartForm()
	if err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "expected multipart/form-data")
		return
	}
	defer func() { _ = form.RemoveAll() }()

	headers := form.File["file"]
	if len(headers) == 0 {
		abortWithError(c, http.StatusBadRequest, "invalid_body", `no files provided under the "file" field`)
		return
	}

	saved := make([]service.FileInfo, 0, len(headers))
	for _, fh := range headers {
		f, err := fh.Open()
		if err != nil {
			abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
			return
		}
		info, err := h.svc.SaveFile(c.Request.Context(), path, fh.Filename, f,
			fh.Size, fh.Header.Get("Content-Type"))
		_ = f.Close()
		if err != nil {
			abortWithServiceError(c, err)
			return
		}
		saved = append(saved, info)
	}
	c.JSON(http.StatusCreated, UploadResponse{Files: saved})
}

// DeleteFile godoc
//
//	@Summary		Delete a file
//	@Description	Removes one file from a drop.
//	@Tags			files
//	@Produce		json
//	@Param			path	query	string	true	"Full path of the file"	example(proyectos/arquitectura/index.html)
//	@Success		204		"deleted"
//	@Failure		400		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Router			/v1/files [delete]
func (h *handler) deleteFile(c *gin.Context) {
	if err := h.svc.DeleteFile(c.Request.Context(), c.Query("path")); err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
