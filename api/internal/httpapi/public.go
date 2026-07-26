package httpapi

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"drop/internal/service"
)

// ServePublicDrop godoc
//
//	@Summary		Open a published drop
//	@Description	Serves a drop's content by slug. Without a path the drop's entrypoint is returned; with one, that file. A leading `@<seq>` segment pins an older version, so `/d/{slug}/@2/` keeps serving what version 2 published. Private drops answer 404, so the response never reveals that the slug exists.
//	@Tags			public
//	@Produce		html
//	@Param			slug		path	string	true	"Drop slug"											example(An1UHNyp)
//	@Param			filepath	path	string	false	"File inside the drop; defaults to the entrypoint"	example(assets/app.css)
//	@Success		200			{file}		binary
//	@Failure		404			{object}	ErrorResponse
//	@Router			/d/{slug}/{filepath} [get]
func (h *handler) servePublicDrop(c *gin.Context) {
	slug := c.Param("slug")
	relPath := strings.TrimPrefix(c.Param("filepath"), "/")

	// A drop — and each of its versions — is a directory, so its root needs the
	// trailing slash: without it the browser resolves the page's relative links
	// one level up and every asset 404s.
	seq, rest, pinned := service.SplitVersionRef(relPath)
	if rest == "" && !strings.HasSuffix(c.Request.URL.Path, "/") {
		c.Redirect(http.StatusMovedPermanently, c.Request.URL.Path+"/")
		return
	}

	body, info, err := h.svc.OpenPublicFile(c.Request.Context(), slug, relPath)
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	defer body.Close()

	contentType := info.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	header := c.Writer.Header()
	// Published content is untrusted and, until it moves to its own domain,
	// shares this origin with the admin API. `sandbox` puts the document in an
	// opaque origin so its scripts cannot reach anything belonging to this one;
	// allow-scripts keeps the page itself working, and top-navigation is scoped
	// to user activation so a published site's own links still work while a
	// script cannot redirect the visitor on its own.
	header.Set("Content-Security-Policy",
		"sandbox allow-scripts allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Referrer-Policy", "no-referrer")
	// Files are editable in place, so a stale copy would be confusing.
	header.Set("Cache-Control", "no-cache")

	// The badge is appended to HTML pages only, and only when it fits in the
	// buffer: everything else is streamed through untouched.
	if h.injectWidget && isHTMLContentType(contentType) && info.Size <= maxInjectableHTML {
		page, err := io.ReadAll(io.LimitReader(body, maxInjectableHTML+1))
		if err != nil {
			abortWithError(c, http.StatusInternalServerError, "internal_error", "could not read the page")
			return
		}
		if int64(len(page)) <= maxInjectableHTML {
			published, derr := h.svc.GetPublishedVersion(c.Request.Context(), slug, seq, pinned)
			if derr == nil {
				if injected, ierr := injectWidget(page, newWidgetData(published)); ierr == nil {
					page = injected
				}
			}
		}
		c.Data(http.StatusOK, contentType, page)
		return
	}

	c.DataFromReader(http.StatusOK, info.Size, contentType, body, nil)
}
