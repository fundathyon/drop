package httpapi

import (
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"drop/internal/adminui"
	"drop/internal/model"
	"drop/internal/objects"
	"drop/internal/service"
)

// maxEditableSize caps what the editor will load into a textarea. Past it a
// file is offered for download instead: a browser handed several megabytes of
// text in a form field stalls, and nobody edits a bundle by hand anyway.
const maxEditableSize = 512 << 10

// flashCookie carries a one-shot message across the redirect that follows every
// mutation. Keeping it out of the URL means a reload does not replay it.
const flashCookie = "drop_flash"

// viewCookie remembers grid or list, so the choice survives navigating into a
// folder rather than resetting on every page.
const viewCookie = "drop_view"

type adminHandler struct {
	svc *service.Service
	ui  *adminui.Renderer
}

// index is the explorer. A path is either a folder to list or a drop to open;
// the service decides, by answering ErrIsDrop for the latter.
func (a *adminHandler) index(c *gin.Context) {
	path := c.Query("path")
	flash := takeFlash(c)

	nodes, err := a.svc.List(c.Request.Context(), path)
	if err == nil {
		a.render(c, http.StatusOK, "explorer", adminui.ExplorerPage{
			Base:  a.base(c, pageTitle(path), path, flash),
			Nodes: nodes,
			Mode:  viewMode(c),
		})
		return
	}
	if !errors.Is(err, service.ErrIsDrop) {
		a.fail(c, path, err)
		return
	}

	detail, err := a.svc.GetDrop(c.Request.Context(), path)
	if err != nil {
		a.fail(c, adminui.ParentOf(path), err)
		return
	}
	a.render(c, http.StatusOK, "drop", adminui.DropPage{
		Base:   a.base(c, detail.Meta.Title, path, flash),
		Detail: detail,
	})
}

// edit shows one file. The drop and the file name arrive separately because a
// file name can itself contain slashes, which leaves no way to tell from a
// single path where the drop ends and the file begins.
func (a *adminHandler) edit(c *gin.Context) {
	dropPath := c.Query("path")
	name := c.Query("name")
	if dropPath == "" || name == "" {
		a.fail(c, dropPath, service.ErrInvalidPath)
		return
	}
	full := adminui.JoinPath(dropPath, name)

	body, info, err := a.svc.OpenFile(c.Request.Context(), full)
	if err != nil {
		a.fail(c, dropPath, err)
		return
	}
	defer body.Close()

	fileType := adminui.TypeOf(name)
	page := adminui.EditorPage{
		Base:     a.base(c, name, full, takeFlash(c)),
		DropPath: dropPath,
		Name:     name,
		File:     info,
		Type:     fileType,
		RawURL:   "/v1/files?path=" + url.QueryEscape(full),
	}
	// Crumbs address folders, and the file is not one: the last step is the
	// drop, and the file name is the page title.
	page.Crumbs = adminui.Breadcrumbs(dropPath)
	page.Path = dropPath

	if fileType.Editable && info.Size <= maxEditableSize {
		content, err := io.ReadAll(io.LimitReader(body, maxEditableSize+1))
		if err != nil {
			a.fail(c, dropPath, err)
			return
		}
		// Bytes that are not text would reach the textarea as replacement
		// characters, and saving would write that damage back.
		if utf8.Valid(content) {
			page.Content = string(content)
		} else {
			page.Type.Editable = false
		}
	} else {
		page.Type.Editable = false
	}

	a.render(c, http.StatusOK, "editor", page)
}

func (a *adminHandler) createFolder(c *gin.Context) {
	parent := c.PostForm("parent")
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		a.fail(c, parent, service.ErrInvalidPath)
		return
	}
	if _, err := a.svc.CreateFolder(c.Request.Context(), parent, name); err != nil {
		a.fail(c, parent, err)
		return
	}
	a.done(c, parent, "Carpeta \""+name+"\" creada")
}

func (a *adminHandler) createDrop(c *gin.Context) {
	parent := c.PostForm("parent")
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		a.fail(c, parent, service.ErrInvalidPath)
		return
	}
	detail, err := a.svc.CreateDrop(c.Request.Context(), service.DropInput{
		Parent:     parent,
		Name:       name,
		Title:      strings.TrimSpace(c.PostForm("title")),
		Visibility: model.Visibility(c.PostForm("visibility")),
		Entrypoint: strings.TrimSpace(c.PostForm("entrypoint")),
	})
	if err != nil {
		a.fail(c, parent, err)
		return
	}
	// Landing inside the new drop is the next thing anyone wants: it has no
	// files yet.
	a.done(c, detail.Path, "Drop \""+name+"\" creado")
}

func (a *adminHandler) updateMeta(c *gin.Context) {
	path := c.PostForm("path")
	title := c.PostForm("title")
	entrypoint := c.PostForm("entrypoint")
	visibility := model.Visibility(c.PostForm("visibility"))

	_, err := a.svc.UpdateDropMeta(c.Request.Context(), path, service.DropPatch{
		Title:      &title,
		Entrypoint: &entrypoint,
		Visibility: &visibility,
	})
	if err != nil {
		a.fail(c, path, err)
		return
	}
	a.done(c, path, "Metadata actualizada")
}

func (a *adminHandler) restoreVersion(c *gin.Context) {
	path := c.PostForm("path")
	seq, err := strconv.ParseUint(c.PostForm("seq"), 10, 64)
	if err != nil || seq == 0 {
		a.fail(c, path, service.ErrInvalidPath)
		return
	}
	if _, err := a.svc.ActivateVersion(c.Request.Context(), path, uint(seq)); err != nil {
		a.fail(c, path, err)
		return
	}
	a.done(c, path, "Ahora se publica la versión "+strconv.FormatUint(seq, 10))
}

func (a *adminHandler) deleteNode(c *gin.Context) {
	path := c.PostForm("path")
	back := c.PostForm("return")
	if path == "" {
		a.fail(c, back, service.ErrInvalidPath)
		return
	}
	if err := a.svc.Delete(c.Request.Context(), path); err != nil {
		a.fail(c, back, err)
		return
	}
	a.done(c, back, "Eliminado \""+lastSegment(path)+"\"")
}

func (a *adminHandler) uploadFiles(c *gin.Context) {
	path := c.PostForm("path")

	form, err := c.MultipartForm()
	if err != nil {
		a.fail(c, path, err)
		return
	}
	defer func() { _ = form.RemoveAll() }()

	headers := form.File["file"]
	if len(headers) == 0 {
		a.fail(c, path, errors.New("no files provided"))
		return
	}
	for _, fh := range headers {
		f, err := fh.Open()
		if err != nil {
			a.fail(c, path, err)
			return
		}
		_, err = a.svc.SaveFile(c.Request.Context(), path, fh.Filename, f,
			fh.Size, fh.Header.Get("Content-Type"))
		_ = f.Close()
		if err != nil {
			a.fail(c, path, err)
			return
		}
	}

	if len(headers) == 1 {
		a.done(c, path, "Archivo subido")
		return
	}
	a.done(c, path, strconv.Itoa(len(headers))+" archivos subidos")
}

func (a *adminHandler) saveFile(c *gin.Context) {
	dropPath := c.PostForm("path")
	name := c.PostForm("name")
	if dropPath == "" || name == "" {
		a.fail(c, dropPath, service.ErrInvalidPath)
		return
	}

	// A textarea is submitted with CRLF line endings whatever it was given
	// (HTML §form-submission), so saving without this rewrites every line of
	// every file the first time it is opened.
	content := strings.ReplaceAll(c.PostForm("content"), "\r\n", "\n")

	_, err := a.svc.SaveFile(c.Request.Context(), dropPath, name,
		strings.NewReader(content), int64(len(content)), adminui.TypeOf(name).ContentType)
	if err != nil {
		a.fail(c, dropPath, err)
		return
	}
	a.done(c, dropPath, "Archivo \""+name+"\" guardado")
}

func (a *adminHandler) deleteFile(c *gin.Context) {
	path := c.PostForm("path")
	back := c.PostForm("return")
	if err := a.svc.DeleteFile(c.Request.Context(), path); err != nil {
		a.fail(c, back, err)
		return
	}
	a.done(c, back, "Archivo \""+lastSegment(path)+"\" eliminado")
}

// ---------- plumbing ----------

// base fills the shell. The signed-in account comes from the context the
// session middleware put it in; the layout keys the whole navigation off it, so
// forgetting it here would render the admin as if nobody were signed in.
func (a *adminHandler) base(c *gin.Context, title, path string, flash *adminui.Flash) adminui.Base {
	b := adminui.Base{
		Title:  title + " · Drop",
		Path:   path,
		Crumbs: adminui.Breadcrumbs(path),
		Flash:  flash,
	}
	if user, ok := currentUser(c); ok {
		b.User = &user
	}
	return b
}

func (a *adminHandler) render(c *gin.Context, status int, page string, data any) {
	renderPage(c, a.ui, status, page, data)
}

// done redirects back to a location after a successful mutation, so a reload
// does not repeat the write.
func (a *adminHandler) done(c *gin.Context, path, message string) {
	setFlash(c, "ok", message)
	c.Redirect(http.StatusSeeOther, "/?path="+url.QueryEscape(path))
}

// fail is done's counterpart: the user lands back where they were, with the
// reason it did not work.
func (a *adminHandler) fail(c *gin.Context, path string, err error) {
	setFlash(c, "error", adminErrorMessage(err))
	c.Redirect(http.StatusSeeOther, "/?path="+url.QueryEscape(path))
}

// adminErrorMessage translates a domain error for a person. The JSON API has
// its own mapping in errors.go; this one is the same set of cases in the
// interface's language.
func adminErrorMessage(err error) string {
	switch {
	case errors.Is(err, service.ErrNotFound), errors.Is(err, objects.ErrNotFound):
		return "No se encontró el recurso"
	case errors.Is(err, service.ErrExists):
		return "Ya existe un elemento con ese nombre"
	case errors.Is(err, service.ErrIsDrop):
		return "Esa ruta es un drop, no una carpeta"
	case errors.Is(err, service.ErrInvalidVisibility):
		return "La visibilidad debe ser public, unlisted o private"
	case errors.Is(err, service.ErrEntrypointMissing):
		return "El entrypoint no está entre los archivos del drop"
	case errors.Is(err, service.ErrNotDrop):
		return "Esa ruta no es un drop"
	case errors.Is(err, service.ErrNotFolder):
		return "Esa ruta no es una carpeta"
	case errors.Is(err, service.ErrInvalidPath):
		return "Ruta o nombre no válido"
	default:
		slog.Error("admin action failed", "error", err)
		return "Error inesperado"
	}
}

func setFlash(c *gin.Context, kind, message string) {
	const maxMessage = 300
	if len(message) > maxMessage {
		message = message[:maxMessage]
	}
	value := base64.RawURLEncoding.EncodeToString([]byte(kind + "\x00" + message))
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     flashCookie,
		Value:    value,
		Path:     "/",
		MaxAge:   30,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

// takeFlash reads the pending message and clears it, so it shows once.
func takeFlash(c *gin.Context) *adminui.Flash {
	raw, err := c.Cookie(flashCookie)
	if err != nil || raw == "" {
		return nil
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name: flashCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true,
	})

	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil
	}
	kind, message, ok := strings.Cut(string(decoded), "\x00")
	if !ok || (kind != "ok" && kind != "error") {
		return nil
	}
	return &adminui.Flash{Kind: kind, Text: message}
}

// viewMode reads the grid/list choice, preferring an explicit one in the URL
// and remembering it for the next page.
func viewMode(c *gin.Context) string {
	mode := c.Query("view")
	if mode != "grid" && mode != "list" {
		if stored, err := c.Cookie(viewCookie); err == nil && (stored == "grid" || stored == "list") {
			return stored
		}
		return "grid"
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name: viewCookie, Value: mode, Path: "/", MaxAge: 31536000, SameSite: http.SameSiteLaxMode,
	})
	return mode
}

func pageTitle(path string) string {
	if path == "" {
		return "Inicio"
	}
	return lastSegment(path)
}

func lastSegment(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}
