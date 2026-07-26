package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"drop/internal/adminui"
	"drop/internal/auth"
	"drop/internal/model"
)

type authHandler struct {
	svc *auth.Service
	ui  *adminui.Renderer
	// cookieSecure marks the session cookie Secure; off for plain-HTTP localhost.
	cookieSecure bool
	logins       *attemptLimiter
}

// ---------- signing in ----------

func (a *authHandler) loginPage(c *gin.Context) {
	// Already signed in: there is nothing to ask for.
	if token, err := c.Cookie(sessionCookie); err == nil && token != "" {
		if _, err := a.svc.SessionUser(c.Request.Context(), token); err == nil {
			c.Redirect(http.StatusSeeOther, safeNext(c.Query("next")))
			return
		}
	}
	a.renderLogin(c, http.StatusOK, "", c.Query("email"))
}

func (a *authHandler) login(c *gin.Context) {
	email := strings.TrimSpace(c.PostForm("email"))
	password := c.PostForm("password")

	tokens, user, err := a.svc.Login(c.Request.Context(), email, password, auth.Device{
		UserAgent: c.Request.UserAgent(),
		IP:        c.ClientIP(),
	})
	if err != nil {
		message := "Email o contraseña incorrectos"
		if errors.Is(err, auth.ErrAccountDisabled) {
			message = "Esta cuenta está desactivada"
		} else if !errors.Is(err, auth.ErrInvalidCredentials) {
			message = "Error inesperado al iniciar sesión"
		}
		a.renderLogin(c, http.StatusUnauthorized, message, email)
		return
	}

	// A user who mistyped a couple of times and then got it right should not be
	// left throttled by their own attempts.
	a.logins.reset(c.ClientIP())

	setSessionCookie(c, tokens.RefreshToken, tokens.RefreshUntil, a.cookieSecure)
	_ = user
	c.Redirect(http.StatusSeeOther, safeNext(c.PostForm("next")))
}

func (a *authHandler) logout(c *gin.Context) {
	if token, err := c.Cookie(sessionCookie); err == nil && token != "" {
		if err := a.svc.Logout(c.Request.Context(), token); err != nil {
			// The cookie is going regardless: leaving someone signed in because
			// the revocation failed is the worse outcome.
			_ = err
		}
	}
	clearSessionCookie(c, a.cookieSecure)
	c.Redirect(http.StatusSeeOther, "/login")
}

func (a *authHandler) tooManyLogins(c *gin.Context) {
	a.renderLogin(c, http.StatusTooManyRequests,
		"Demasiados intentos. Espera un minuto y vuelve a probar.", c.PostForm("email"))
}

func (a *authHandler) renderLogin(c *gin.Context, status int, errorMessage, email string) {
	page := adminui.LoginPage{
		Base:  adminui.Base{Title: "Entrar · Drop"},
		Email: email,
		Next:  safeNext(firstNonEmpty(c.PostForm("next"), c.Query("next"))),
		Error: errorMessage,
	}
	renderPage(c, a.ui, status, "login", page)
}

// ---------- accepting an invitation ----------

func (a *authHandler) invitePage(c *gin.Context) {
	token := c.Query("token")
	invitation, err := a.svc.InvitationByToken(c.Request.Context(), token)
	if err != nil {
		a.renderInvite(c, http.StatusGone, adminui.InvitePage{
			Base:  adminui.Base{Title: "Invitación · Drop"},
			Error: "Esta invitación ya no es válida. Pide una nueva al administrador.",
		})
		return
	}
	a.renderInvite(c, http.StatusOK, adminui.InvitePage{
		Base:       adminui.Base{Title: "Crear cuenta · Drop"},
		Token:      token,
		Email:      invitation.Email,
		Role:       string(invitation.Role),
		MinLength:  auth.MinPasswordLength,
		Acceptable: true,
	})
}

func (a *authHandler) acceptInvite(c *gin.Context) {
	token := c.PostForm("token")
	name := c.PostForm("name")
	password := c.PostForm("password")

	if password != c.PostForm("password_confirm") {
		a.reshowInvite(c, token, name, "Las contraseñas no coinciden")
		return
	}

	user, err := a.svc.AcceptInvitation(c.Request.Context(), token, name, password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidInput) {
			a.reshowInvite(c, token, name, err.Error())
			return
		}
		a.renderInvite(c, http.StatusGone, adminui.InvitePage{
			Base:  adminui.Base{Title: "Invitación · Drop"},
			Error: "Esta invitación ya no es válida. Pide una nueva al administrador.",
		})
		return
	}

	// Straight to the login form rather than signing them in: it makes the
	// password they just chose the one they immediately use, which is what makes
	// it stick.
	setFlash(c, "ok", "Cuenta creada. Ya puedes entrar.")
	c.Redirect(http.StatusSeeOther, "/login?email="+url.QueryEscape(user.Email))
}

// reshowInvite redraws the form with the error, keeping the invitation valid:
// a mistyped password must not burn a single-use link.
func (a *authHandler) reshowInvite(c *gin.Context, token, name, message string) {
	invitation, err := a.svc.InvitationByToken(c.Request.Context(), token)
	if err != nil {
		a.renderInvite(c, http.StatusGone, adminui.InvitePage{
			Base:  adminui.Base{Title: "Invitación · Drop"},
			Error: "Esta invitación ya no es válida. Pide una nueva al administrador.",
		})
		return
	}
	a.renderInvite(c, http.StatusBadRequest, adminui.InvitePage{
		Base:       adminui.Base{Title: "Crear cuenta · Drop"},
		Token:      token,
		Email:      invitation.Email,
		Role:       string(invitation.Role),
		Name:       name,
		MinLength:  auth.MinPasswordLength,
		Acceptable: true,
		Error:      message,
	})
}

func (a *authHandler) renderInvite(c *gin.Context, status int, page adminui.InvitePage) {
	renderPage(c, a.ui, status, "invite", page)
}

// ---------- managing accounts ----------

func (a *authHandler) usersPage(c *gin.Context) {
	me, _ := currentUser(c)

	users, err := a.svc.ListUsers(c.Request.Context())
	if err != nil {
		a.failUsers(c, err)
		return
	}
	invitations, err := a.svc.ListInvitations(c.Request.Context())
	if err != nil {
		a.failUsers(c, err)
		return
	}

	renderPage(c, a.ui, http.StatusOK, "users", adminui.UsersPage{
		Base: adminui.Base{
			Title: "Usuarios · Drop",
			Flash: takeFlash(c),
			User:  &me,
		},
		Users:       users,
		Invitations: invitations,
		Me:          me,
		// Shown once, right after creating one: the token is only ever in the
		// response that minted it.
		NewLink: c.Query("link"),
	})
}

func (a *authHandler) createInvitation(c *gin.Context) {
	me, _ := currentUser(c)

	info, token, err := a.svc.CreateInvitation(c.Request.Context(),
		c.PostForm("email"), model.Role(c.PostForm("role")), me.ID)
	if err != nil {
		a.failUsers(c, err)
		return
	}

	link := absoluteURL(c, "/invitacion?token="+url.QueryEscape(token))
	setFlash(c, "ok", "Invitación creada para "+info.Email)
	// The link travels in the redirect because there is nowhere else it can
	// come from later: only its hash is stored.
	c.Redirect(http.StatusSeeOther, "/admin/usuarios?link="+url.QueryEscape(link))
}

func (a *authHandler) revokeInvitation(c *gin.Context) {
	id, err := strconv.ParseUint(c.PostForm("id"), 10, 64)
	if err != nil {
		a.failUsers(c, auth.ErrNotFound)
		return
	}
	if _, err := a.svc.RevokeInvitation(c.Request.Context(), uint(id)); err != nil {
		a.failUsers(c, err)
		return
	}
	a.doneUsers(c, "Invitación revocada")
}

func (a *authHandler) setUserActive(c *gin.Context) {
	me, _ := currentUser(c)

	id, err := strconv.ParseUint(c.PostForm("id"), 10, 64)
	if err != nil {
		a.failUsers(c, auth.ErrNotFound)
		return
	}
	active := c.PostForm("active") == "true"

	if _, err := a.svc.SetUserActive(c.Request.Context(), uint(id), active, me.ID); err != nil {
		a.failUsers(c, err)
		return
	}
	if active {
		a.doneUsers(c, "Cuenta reactivada")
		return
	}
	a.doneUsers(c, "Cuenta desactivada")
}

func (a *authHandler) deleteUser(c *gin.Context) {
	me, _ := currentUser(c)

	id, err := strconv.ParseUint(c.PostForm("id"), 10, 64)
	if err != nil {
		a.failUsers(c, auth.ErrNotFound)
		return
	}
	if err := a.svc.DeleteUser(c.Request.Context(), uint(id), me.ID); err != nil {
		a.failUsers(c, err)
		return
	}
	a.doneUsers(c, "Cuenta eliminada")
}

func (a *authHandler) doneUsers(c *gin.Context, message string) {
	setFlash(c, "ok", message)
	c.Redirect(http.StatusSeeOther, "/admin/usuarios")
}

func (a *authHandler) failUsers(c *gin.Context, err error) {
	setFlash(c, "error", authMessage(err))
	c.Redirect(http.StatusSeeOther, "/admin/usuarios")
}

// authMessage translates an auth failure for a person, the way
// adminErrorMessage does for the drop tree.
func authMessage(err error) string {
	switch {
	case errors.Is(err, auth.ErrNotFound):
		return "No se encontró la cuenta"
	case errors.Is(err, auth.ErrExists):
		return "Ese email ya tiene cuenta"
	case errors.Is(err, auth.ErrInvalidInvitation):
		return "Esa invitación ya no se puede usar"
	case errors.Is(err, auth.ErrLastAdmin):
		return "Es el último administrador activo: quedaría nadie que pueda invitar"
	case errors.Is(err, auth.ErrInvalidInput):
		return err.Error()
	default:
		return "Error inesperado"
	}
}

// ---------- helpers ----------

// safeNext keeps a post-login redirect inside this site. Without the check, a
// crafted ?next= would turn the login form into an open redirect.
func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return "/"
	}
	if _, err := url.ParseRequestURI(next); err != nil {
		return "/"
	}
	return next
}

// absoluteURL builds a link the recipient can open, since an invitation is
// handed over out of band.
func absoluteURL(c *gin.Context, path string) string {
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host + path
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// renderPage writes a template, buffering through the renderer so a failure
// halfway does not leave a torn page behind a 200.
func renderPage(c *gin.Context, ui *adminui.Renderer, status int, page string, data any) {
	c.Header("Cache-Control", "no-store")
	c.Status(status)
	c.Header("Content-Type", "text/html; charset=utf-8")
	if err := ui.Render(c.Writer, page, data); err != nil {
		// The status line is already out, so there is nothing left to signal
		// with; log it rather than corrupt the response further.
		slog.Error("render admin page", "page", page, "error", err)
	}
}
