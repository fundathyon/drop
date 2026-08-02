package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"drop/internal/adminui"
	"drop/internal/auth"
)

// ---------- first-run setup ----------

func (a *authHandler) setupPage(c *gin.Context) {
	needsSetup, err := a.svc.NeedsSetup(c.Request.Context())
	if err != nil {
		abortWithError(c, http.StatusInternalServerError, "internal_error", "unexpected error")
		return
	}
	// Reachable exactly once: once an administrator exists, this is the login
	// form's job.
	if !needsSetup {
		c.Redirect(http.StatusSeeOther, "/login")
		return
	}
	a.renderSetup(c, http.StatusOK, adminui.SetupPage{
		Base:      adminui.Base{Title: "Configura Drop"},
		MinLength: auth.MinPasswordLength,
	})
}

func (a *authHandler) setup(c *gin.Context) {
	orgName := strings.TrimSpace(c.PostForm("org_name"))
	name := strings.TrimSpace(c.PostForm("name"))
	email := strings.TrimSpace(c.PostForm("email"))
	password := c.PostForm("password")

	reshow := func(status int, message string) {
		a.renderSetup(c, status, adminui.SetupPage{
			Base:      adminui.Base{Title: "Configura Drop"},
			OrgName:   orgName,
			Name:      name,
			Email:     email,
			MinLength: auth.MinPasswordLength,
			Error:     message,
		})
	}

	if password != c.PostForm("password_confirm") {
		reshow(http.StatusBadRequest, "Las contraseñas no coinciden")
		return
	}

	tokens, admin, err := a.svc.SetupInstance(c.Request.Context(), orgName, name, email, password, auth.Device{
		UserAgent: c.Request.UserAgent(),
		IP:        c.ClientIP(),
	})
	if err != nil {
		// Two tabs racing to finish setup: whichever loses is sent to sign in
		// with the password the winner just chose, not shown an error about a
		// state it cannot fix by retrying this form.
		if errors.Is(err, auth.ErrAlreadySetUp) {
			c.Redirect(http.StatusSeeOther, "/login")
			return
		}
		if errors.Is(err, auth.ErrInvalidInput) {
			reshow(http.StatusBadRequest, err.Error())
			return
		}
		reshow(http.StatusInternalServerError, "Error inesperado al configurar la instancia")
		return
	}

	setSessionCookie(c, tokens.RefreshToken, tokens.RefreshUntil, a.cookieSecure)

	// Best-effort: only matters for a database upgraded from before ownership
	// existed, and the administrator account created above is valid either way.
	if _, err := a.tree.AdoptOwnerlessNodes(c.Request.Context(), admin.ID); err != nil {
		slog.Error("adopt ownerless nodes after setup", "error", err, "owner", admin.Email)
	}

	c.Redirect(http.StatusSeeOther, "/")
}

func (a *authHandler) renderSetup(c *gin.Context, status int, page adminui.SetupPage) {
	renderPage(c, a.ui, status, "setup", page)
}
