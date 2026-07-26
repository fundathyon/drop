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
	"drop/internal/auth"
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
	// accounts is only used to offer a list of people to share with; the tree
	// itself knows nothing about users beyond their ids.
	accounts *auth.Service
	ui       *adminui.Renderer
}

// refOf builds the reference a request addresses. A path stopped being enough
// once every user got their own tree: "owner" says whose drive it is in, and
// its absence means the caller's own.
func refOf(c *gin.Context, path string) service.Ref {
	raw := c.Query("owner")
	if raw == "" {
		raw = c.PostForm("owner")
	}
	owner, _ := strconv.ParseUint(raw, 10, 64)
	return service.Ref{Owner: uint(owner), Path: path}
}

// actorOf is who the request is on behalf of. Zero is impossible on the admin
// routes, which all sit behind the session middleware.
func actorOf(c *gin.Context) uint {
	user, _ := currentUser(c)
	return user.ID
}

// index is the explorer. A path is either a folder to list or a drop to open;
// the service decides, by answering ErrIsDrop for the latter.
func (a *adminHandler) index(c *gin.Context) {
	actor := actorOf(c)
	ref := refOf(c, c.Query("path"))
	flash := takeFlash(c)

	nodes, err := a.svc.List(c.Request.Context(), actor, ref)
	if err == nil {
		a.render(c, http.StatusOK, "explorer", adminui.ExplorerPage{
			Base:  a.base(c, pageTitle(ref.Path), ref, flash),
			Nodes: nodes,
			Mode:  viewMode(c),
		})
		return
	}
	if !errors.Is(err, service.ErrIsDrop) {
		a.fail(c, ref, err)
		return
	}

	detail, err := a.svc.GetDrop(c.Request.Context(), actor, ref)
	if err != nil {
		a.fail(c, parentRef(ref), err)
		return
	}
	shares, people, err := a.sharing(c, actor, ref, detail)
	if err != nil {
		a.fail(c, parentRef(ref), err)
		return
	}
	a.render(c, http.StatusOK, "drop", adminui.DropPage{
		Base:   a.base(c, detail.Meta.Title, ref, flash),
		Detail: detail,
		Shares: shares,
		People: people,
	})
}

// shared lists what other people granted the caller.
func (a *adminHandler) shared(c *gin.Context) {
	actor := actorOf(c)
	nodes, err := a.svc.ListSharedWithMe(c.Request.Context(), actor)
	if err != nil {
		a.fail(c, service.Ref{}, err)
		return
	}
	base := a.base(c, "Compartido conmigo", service.Ref{}, takeFlash(c))
	base.Shared = true
	a.render(c, http.StatusOK, "shared", adminui.SharedPage{Base: base, Nodes: nodes})
}

// sharing loads who has access and who it could still be given to, but only
// for someone entitled to hand it out.
func (a *adminHandler) sharing(c *gin.Context, actor uint, ref service.Ref, detail service.DropDetail) ([]service.ShareInfo, []auth.UserInfo, error) {
	if !detail.Access.CanShare() {
		return nil, nil, nil
	}
	shares, err := a.svc.ListShares(c.Request.Context(), actor, ref)
	if err != nil {
		return nil, nil, err
	}
	users, err := a.accounts.ListUsers(c.Request.Context())
	if err != nil {
		return nil, nil, err
	}
	// The owner already has everything a grant could give, and a disabled
	// account cannot sign in to use one.
	people := make([]auth.UserInfo, 0, len(users))
	for _, u := range users {
		if u.ID == detail.Owner || !u.Active {
			continue
		}
		people = append(people, u)
	}
	return shares, people, nil
}

// edit shows one file. The drop and the file name arrive separately because a
// file name can itself contain slashes, which leaves no way to tell from a
// single path where the drop ends and the file begins.
func (a *adminHandler) edit(c *gin.Context) {
	actor := actorOf(c)
	dropRef := refOf(c, c.Query("path"))
	name := c.Query("name")
	if dropRef.Path == "" || name == "" {
		a.fail(c, dropRef, service.ErrInvalidPath)
		return
	}
	fullRef := service.Ref{Owner: dropRef.Owner, Path: adminui.JoinPath(dropRef.Path, name)}

	body, info, err := a.svc.OpenFile(c.Request.Context(), actor, fullRef)
	if err != nil {
		a.fail(c, dropRef, err)
		return
	}
	defer body.Close()

	drop, err := a.svc.GetDrop(c.Request.Context(), actor, dropRef)
	if err != nil {
		a.fail(c, dropRef, err)
		return
	}

	fileType := adminui.TypeOf(name)
	page := adminui.EditorPage{
		Base:      a.base(c, name, dropRef, takeFlash(c)),
		DropPath:  dropRef.Path,
		DropOwner: dropRef.Owner,
		Name:      name,
		File:      info,
		Type:      fileType,
		RawURL:    "/v1/files?" + fileQuery(fullRef),
		ReadOnly:  !drop.Access.CanWrite(),
	}

	if fileType.Editable && info.Size <= maxEditableSize {
		content, err := io.ReadAll(io.LimitReader(body, maxEditableSize+1))
		if err != nil {
			a.fail(c, dropRef, err)
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
	parent := refOf(c, c.PostForm("parent"))
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		a.fail(c, parent, service.ErrInvalidPath)
		return
	}
	if _, err := a.svc.CreateFolder(c.Request.Context(), actorOf(c), parent, name); err != nil {
		a.fail(c, parent, err)
		return
	}
	a.done(c, parent, "Carpeta \""+name+"\" creada")
}

func (a *adminHandler) createDrop(c *gin.Context) {
	parent := refOf(c, c.PostForm("parent"))
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		a.fail(c, parent, service.ErrInvalidPath)
		return
	}
	detail, err := a.svc.CreateDrop(c.Request.Context(), actorOf(c), service.DropInput{
		ParentRef:  parent,
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
	a.done(c, service.Ref{Owner: detail.Owner, Path: detail.Path}, "Drop \""+name+"\" creado")
}

func (a *adminHandler) updateMeta(c *gin.Context) {
	ref := refOf(c, c.PostForm("path"))
	title := c.PostForm("title")
	entrypoint := c.PostForm("entrypoint")
	visibility := model.Visibility(c.PostForm("visibility"))

	_, err := a.svc.UpdateDropMeta(c.Request.Context(), actorOf(c), ref, service.DropPatch{
		Title:      &title,
		Entrypoint: &entrypoint,
		Visibility: &visibility,
	})
	if err != nil {
		a.fail(c, ref, err)
		return
	}
	a.done(c, ref, "Metadata actualizada")
}

func (a *adminHandler) restoreVersion(c *gin.Context) {
	ref := refOf(c, c.PostForm("path"))
	seq, err := strconv.ParseUint(c.PostForm("seq"), 10, 64)
	if err != nil || seq == 0 {
		a.fail(c, ref, service.ErrInvalidPath)
		return
	}
	if _, err := a.svc.ActivateVersion(c.Request.Context(), actorOf(c), ref, uint(seq)); err != nil {
		a.fail(c, ref, err)
		return
	}
	a.done(c, ref, "Ahora se publica la versión "+strconv.FormatUint(seq, 10))
}

func (a *adminHandler) deleteNode(c *gin.Context) {
	ref := refOf(c, c.PostForm("path"))
	back := refOf(c, c.PostForm("return"))
	if ref.Path == "" {
		a.fail(c, back, service.ErrInvalidPath)
		return
	}
	if err := a.svc.Delete(c.Request.Context(), actorOf(c), ref); err != nil {
		a.fail(c, back, err)
		return
	}
	a.done(c, back, "Eliminado \""+lastSegment(ref.Path)+"\"")
}

func (a *adminHandler) uploadFiles(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		a.fail(c, service.Ref{}, err)
		return
	}
	defer func() { _ = form.RemoveAll() }()

	actor := actorOf(c)
	ref := refOf(c, c.PostForm("path"))

	headers := form.File["file"]
	if len(headers) == 0 {
		a.fail(c, ref, errors.New("no files provided"))
		return
	}
	for _, fh := range headers {
		f, err := fh.Open()
		if err != nil {
			a.fail(c, ref, err)
			return
		}
		_, err = a.svc.SaveFile(c.Request.Context(), actor, ref, fh.Filename, f,
			fh.Size, fh.Header.Get("Content-Type"))
		_ = f.Close()
		if err != nil {
			a.fail(c, ref, err)
			return
		}
	}

	if len(headers) == 1 {
		a.done(c, ref, "Archivo subido")
		return
	}
	a.done(c, ref, strconv.Itoa(len(headers))+" archivos subidos")
}

func (a *adminHandler) saveFile(c *gin.Context) {
	ref := refOf(c, c.PostForm("path"))
	name := c.PostForm("name")
	if ref.Path == "" || name == "" {
		a.fail(c, ref, service.ErrInvalidPath)
		return
	}

	// A textarea is submitted with CRLF line endings whatever it was given
	// (HTML §form-submission), so saving without this rewrites every line of
	// every file the first time it is opened.
	content := strings.ReplaceAll(c.PostForm("content"), "\r\n", "\n")

	_, err := a.svc.SaveFile(c.Request.Context(), actorOf(c), ref, name,
		strings.NewReader(content), int64(len(content)), adminui.TypeOf(name).ContentType)
	if err != nil {
		a.fail(c, ref, err)
		return
	}
	a.done(c, ref, "Archivo \""+name+"\" guardado")
}

func (a *adminHandler) deleteFile(c *gin.Context) {
	ref := refOf(c, c.PostForm("path"))
	back := refOf(c, c.PostForm("return"))
	if err := a.svc.DeleteFile(c.Request.Context(), actorOf(c), ref); err != nil {
		a.fail(c, back, err)
		return
	}
	a.done(c, back, "Archivo \""+lastSegment(ref.Path)+"\" eliminado")
}

// ---------- plumbing ----------

// base fills the shell. The signed-in account comes from the context the
// session middleware put it in; the layout keys the whole navigation off it, so
// forgetting it here would render the admin as if nobody were signed in.
func (a *adminHandler) base(c *gin.Context, title string, ref service.Ref, flash *adminui.Flash) adminui.Base {
	b := adminui.Base{
		Title:  title + " · Drop",
		Path:   ref.Path,
		Owner:  ref.Owner,
		Crumbs: adminui.Breadcrumbs(ref),
		Flash:  flash,
		// Browsing another drive is still the shared section, however deep in
		// you are — the tab should not claim you are in your own.
		Shared: ref.Owner != 0,
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
func (a *adminHandler) done(c *gin.Context, ref service.Ref, message string) {
	setFlash(c, "ok", message)
	c.Redirect(http.StatusSeeOther, "/?"+refQuery(ref))
}

// fail is done's counterpart: the user lands back where they were, with the
// reason it did not work.
func (a *adminHandler) fail(c *gin.Context, ref service.Ref, err error) {
	setFlash(c, "error", adminErrorMessage(err))
	c.Redirect(http.StatusSeeOther, "/?"+refQuery(ref))
}

// refQuery renders a reference as a query string. The owner is left out when
// it is the caller's own drive, which keeps every ordinary URL as short as it
// was before drives existed.
func refQuery(ref service.Ref) string {
	q := url.Values{}
	if ref.Owner != 0 {
		q.Set("owner", strconv.FormatUint(uint64(ref.Owner), 10))
	}
	q.Set("path", ref.Path)
	return q.Encode()
}

// fileQuery addresses a stored file for /v1/files, which takes the full path.
func fileQuery(ref service.Ref) string {
	q := url.Values{}
	if ref.Owner != 0 {
		q.Set("owner", strconv.FormatUint(uint64(ref.Owner), 10))
	}
	q.Set("path", ref.Path)
	return q.Encode()
}

// parentRef is the containing folder of a reference, in the same drive.
func parentRef(ref service.Ref) service.Ref {
	return service.Ref{Owner: ref.Owner, Path: adminui.ParentOf(ref.Path)}
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
	case errors.Is(err, service.ErrForbidden):
		return "No tienes permiso para hacer eso"
	case errors.Is(err, service.ErrCannotShareWithSelf):
		return "El dueño ya tiene acceso"
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

// ---------- sharing ----------

func (a *adminHandler) share(c *gin.Context) {
	ref := refOf(c, c.PostForm("path"))
	userID, err := strconv.ParseUint(c.PostForm("user_id"), 10, 64)
	if err != nil || userID == 0 {
		a.fail(c, ref, service.ErrNotFound)
		return
	}
	access := service.Access(c.PostForm("access"))

	info, err := a.svc.Share(c.Request.Context(), actorOf(c), ref, uint(userID), access)
	if err != nil {
		a.fail(c, ref, err)
		return
	}
	a.done(c, ref, "Compartido con "+info.Email+" como "+string(info.Access))
}

func (a *adminHandler) unshare(c *gin.Context) {
	ref := refOf(c, c.PostForm("path"))
	userID, err := strconv.ParseUint(c.PostForm("user_id"), 10, 64)
	if err != nil || userID == 0 {
		a.fail(c, ref, service.ErrNotFound)
		return
	}
	if err := a.svc.Unshare(c.Request.Context(), actorOf(c), ref, uint(userID)); err != nil {
		a.fail(c, ref, err)
		return
	}
	a.done(c, ref, "Acceso revocado")
}
