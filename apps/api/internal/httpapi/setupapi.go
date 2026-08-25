package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"drop/internal/auth"
)

// SetupStatus godoc
//
//	@Summary		Report whether this instance still needs its first administrator
//	@Tags			setup
//	@Produce		json
//	@Success		200	{object}	SetupStatusResponse
//	@Router			/v1/setup/status [get]
func (a *apiAuthHandler) setupStatus(c *gin.Context) {
	needsSetup, err := a.svc.NeedsSetup(c.Request.Context())
	if err != nil {
		abortWithError(c, http.StatusInternalServerError, "internal_error", "unexpected error")
		return
	}
	c.JSON(http.StatusOK, SetupStatusResponse{NeedsSetup: needsSetup})
}

// Setup godoc
//
//	@Summary		Create the organization and its first administrator
//	@Description	The one thing an empty instance lets happen; everything else stays behind setupGate until this succeeds. Signs the new administrator in, same as login.
//	@Tags			setup
//	@Accept			json
//	@Produce		json
//	@Param			body	body		SetupRequest	true	"Organization and administrator"
//	@Success		200		{object}	TokenResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Router			/v1/setup [post]
func (a *apiAuthHandler) setup(c *gin.Context) {
	var req SetupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Password != req.PasswordConfirm {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "passwords do not match")
		return
	}

	tokens, admin, err := a.svc.SetupInstance(c.Request.Context(), req.OrgName, req.Name, req.Email, req.Password, auth.Device{
		UserAgent: c.Request.UserAgent(),
		IP:        c.ClientIP(),
	})
	if err != nil {
		abortWithAuthError(c, err)
		return
	}

	// Best-effort: only matters for a database upgraded from before ownership
	// existed, and the administrator account created above is valid either way.
	if _, err := a.tree.AdoptOwnerlessNodes(c.Request.Context(), admin.ID); err != nil {
		slog.Error("adopt ownerless nodes after setup", "error", err, "owner", admin.Email)
	}

	c.JSON(http.StatusOK, tokenResponse(tokens, admin))
}
