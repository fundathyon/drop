package httpapi

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"drop/internal/auth"
	"drop/internal/service"
)

// apiAuthHandler serves every auth-adjacent JSON endpoint: sessions, setup,
// invitations, and account management.
type apiAuthHandler struct {
	svc    *auth.Service
	logins *attemptLimiter
	// tree is needed only to adopt ownerless nodes right after setup, the same
	// one-time fixup the HTML wizard performs.
	tree *service.Service
}

func abortWithAuthError(c *gin.Context, err error) {
	status, code, message := authErrorStatus(err)
	if status == http.StatusInternalServerError {
		_ = c.Error(err)
	}
	abortWithError(c, status, code, message)
}

// Login godoc
//
//	@Summary		Open a session
//	@Description	Exchanges email and password for an access token and the refresh token that renews it. Rate limited per client address.
//	@Tags			auth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		LoginRequest	true	"Credentials"
//	@Success		200		{object}	TokenResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@Router			/v1/auth/login [post]
func (a *apiAuthHandler) login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	tokens, user, err := a.svc.Login(c.Request.Context(), req.Email, req.Password, auth.Device{
		UserAgent: c.Request.UserAgent(),
		IP:        c.ClientIP(),
	})
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	a.logins.reset(c.ClientIP())

	c.JSON(http.StatusOK, tokenResponse(tokens, user))
}

// Refresh godoc
//
//	@Summary		Renew an access token
//	@Description	Exchanges a refresh token for a fresh access token. The refresh token itself keeps working until it expires or its session is revoked.
//	@Tags			auth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		RefreshRequest	true	"Refresh token"
//	@Success		200		{object}	TokenResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		429		{object}	ErrorResponse
//	@Router			/v1/auth/refresh [post]
func (a *apiAuthHandler) refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	tokens, user, err := a.svc.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.JSON(http.StatusOK, tokenResponse(tokens, user))
}

// Logout godoc
//
//	@Summary		Close a session
//	@Description	Revokes the session behind a refresh token. Answers 204 whether or not the token was recognized: signing out is not a place to learn which tokens are real.
//	@Tags			auth
//	@Accept			json
//	@Produce		json
//	@Param			body	body	RefreshRequest	true	"Refresh token"
//	@Success		204		"revoked"
//	@Failure		400		{object}	ErrorResponse
//	@Router			/v1/auth/logout [post]
func (a *apiAuthHandler) logout(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := a.svc.Logout(c.Request.Context(), req.RefreshToken); err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// Me godoc
//
//	@Summary		Describe the caller
//	@Tags			auth
//	@Produce		json
//	@Security		BearerAuth
//	@Success		200	{object}	auth.UserInfo
//	@Failure		401	{object}	ErrorResponse
//	@Router			/v1/auth/me [get]
func (a *apiAuthHandler) me(c *gin.Context) {
	user, _ := currentUser(c)
	c.JSON(http.StatusOK, user)
}

// ListUsers godoc
//
//	@Summary		List accounts
//	@Tags			users
//	@Produce		json
//	@Security		BearerAuth
//	@Success		200	{object}	UsersResponse
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Router			/v1/users [get]
func (a *apiAuthHandler) listUsers(c *gin.Context) {
	users, err := a.svc.ListUsers(c.Request.Context())
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.JSON(http.StatusOK, UsersResponse{Users: users})
}

// SetUserActive godoc
//
//	@Summary		Enable or disable an account
//	@Description	Disabling also revokes the user's sessions, so it takes effect at once rather than whenever their access token expires.
//	@Tags			users
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			id		path		int						true	"User id"
//	@Param			body	body		SetUserActiveRequest	true	"Desired state"
//	@Success		200		{object}	auth.UserInfo
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Router			/v1/users/{id}/active [patch]
func (a *apiAuthHandler) setUserActive(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var req SetUserActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	me, _ := currentUser(c)
	user, err := a.svc.SetUserActive(c.Request.Context(), id, *req.Active, me.ID)
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.JSON(http.StatusOK, user)
}

// DeleteUser godoc
//
//	@Summary		Delete an account
//	@Description	Soft-deletes the account and revokes its sessions. The address becomes free to invite again.
//	@Tags			users
//	@Produce		json
//	@Security		BearerAuth
//	@Param			id	path	int	true	"User id"
//	@Success		204	"deleted"
//	@Failure		400	{object}	ErrorResponse
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Failure		404	{object}	ErrorResponse
//	@Failure		409	{object}	ErrorResponse
//	@Router			/v1/users/{id} [delete]
func (a *apiAuthHandler) deleteUser(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	me, _ := currentUser(c)
	if err := a.svc.DeleteUser(c.Request.Context(), id, me.ID); err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ListInvitations godoc
//
//	@Summary		List invitations
//	@Tags			invitations
//	@Produce		json
//	@Security		BearerAuth
//	@Success		200	{object}	InvitationsResponse
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Router			/v1/invitations [get]
func (a *apiAuthHandler) listInvitations(c *gin.Context) {
	invitations, err := a.svc.ListInvitations(c.Request.Context())
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.JSON(http.StatusOK, InvitationsResponse{Invitations: invitations})
}

// CreateInvitation godoc
//
//	@Summary		Invite someone
//	@Description	Issues a single-use link. There is no public sign-up and no email is sent: the link is returned here, once, and handed over by whatever channel you like. Only its hash is stored.
//	@Tags			invitations
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			body	body		CreateInvitationRequest	true	"Who to invite"
//	@Success		201		{object}	CreateInvitationResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		401		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Router			/v1/invitations [post]
func (a *apiAuthHandler) createInvitation(c *gin.Context) {
	var req CreateInvitationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	me, _ := currentUser(c)
	info, token, err := a.svc.CreateInvitation(c.Request.Context(), req.Email, req.Role, me.ID)
	if err != nil {
		abortWithAuthError(c, err)
		return
	}

	c.JSON(http.StatusCreated, CreateInvitationResponse{
		Invitation: info,
		Token:      token,
		URL:        absoluteURL(c, "/invitacion?token="+url.QueryEscape(token)),
	})
}

// RevokeInvitation godoc
//
//	@Summary		Revoke an invitation
//	@Description	Cancels a pending invitation, so its link stops working.
//	@Tags			invitations
//	@Produce		json
//	@Security		BearerAuth
//	@Param			id	path		int	true	"Invitation id"
//	@Success		200	{object}	auth.InvitationInfo
//	@Failure		401	{object}	ErrorResponse
//	@Failure		403	{object}	ErrorResponse
//	@Failure		404	{object}	ErrorResponse
//	@Failure		410	{object}	ErrorResponse
//	@Router			/v1/invitations/{id} [delete]
func (a *apiAuthHandler) revokeInvitation(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	info, err := a.svc.RevokeInvitation(c.Request.Context(), id)
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

// InvitationByToken godoc
//
//	@Summary		Preview an invitation before accepting it
//	@Description	Lets the acceptance page decide what to show before asking for a password. Answers 410 once the invitation is no longer usable — already accepted, expired, or revoked.
//	@Tags			invitations
//	@Produce		json
//	@Param			token	query		string	true	"Invitation token"
//	@Success		200		{object}	auth.InvitationInfo
//	@Failure		410		{object}	ErrorResponse
//	@Router			/v1/invitations/by-token [get]
func (a *apiAuthHandler) invitationByToken(c *gin.Context) {
	info, err := a.svc.InvitationByToken(c.Request.Context(), c.Query("token"))
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

// AcceptInvitation godoc
//
//	@Summary		Create the account behind a pending invitation
//	@Description	The invitation carries the email address, so only a name and a password are asked for. Does not sign the new account in — the password just chosen is the one immediately used to log in.
//	@Tags			invitations
//	@Accept			json
//	@Produce		json
//	@Param			body	body		AcceptInvitationRequest	true	"Token and chosen password"
//	@Success		201		{object}	auth.UserInfo
//	@Failure		400		{object}	ErrorResponse
//	@Failure		410		{object}	ErrorResponse
//	@Router			/v1/invitations/accept [post]
func (a *apiAuthHandler) acceptInvitation(c *gin.Context) {
	var req AcceptInvitationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Password != req.PasswordConfirm {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "passwords do not match")
		return
	}

	user, err := a.svc.AcceptInvitation(c.Request.Context(), req.Token, req.Name, req.Password)
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	c.JSON(http.StatusCreated, user)
}

func tokenResponse(tokens auth.Tokens, user auth.UserInfo) TokenResponse {
	return TokenResponse{
		AccessToken:  tokens.AccessToken,
		TokenType:    "Bearer",
		ExpiresAt:    tokens.ExpiresAt,
		RefreshToken: tokens.RefreshToken,
		RefreshUntil: tokens.RefreshUntil,
		User:         user,
	}
}

func pathID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		abortWithError(c, http.StatusBadRequest, "invalid_id", "id must be a positive integer")
		return 0, false
	}
	return uint(id), true
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
