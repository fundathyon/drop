package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ServePublicDrop godoc
//
//	@Summary		Open a published drop
//	@Description	Serves a drop's content by slug. Without a path the drop's entrypoint is returned; with one, that file. Private drops answer 404, so the response never reveals that the slug exists.
//	@Tags			public
//	@Produce		html
//	@Param			slug	path	string	true	"Drop slug"						example(An1UHNyp)
//	@Param			filepath	path	string	false	"File inside the drop; defaults to the entrypoint"	example(assets/app.css)
//	@Success		200		{file}		binary
//	@Failure		404		{object}	ErrorResponse
//	@Router			/d/{slug}/{filepath} [get]
func (h *handler) servePublicDrop(c *gin.Context) {
	slug := c.Param("slug")
	relPath := strings.TrimPrefix(c.Param("filepath"), "/")

	// A drop is a directory, so its root needs the trailing slash: without it
	// the browser resolves the page's relative links against /d/ and drops the
	// slug, and every asset 404s.
	if relPath == "" && !strings.HasSuffix(c.Request.URL.Path, "/") {
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
	// allow-scripts keeps the page itself working.
	header.Set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Referrer-Policy", "no-referrer")
	// Files are editable in place, so a stale copy would be confusing.
	header.Set("Cache-Control", "no-cache")

	c.DataFromReader(http.StatusOK, info.Size, contentType, body, nil)
}
