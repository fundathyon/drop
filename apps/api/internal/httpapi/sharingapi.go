package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"drop/internal/auth"
	"drop/internal/service"
)

// nodeOwner is whose drive a ref addresses: the ref's own Owner when it names
// someone else's drive, otherwise the caller. Every node in a drive carries
// that same owner, so this needs no lookup — the Ref already says it.
func nodeOwner(actor uint, ref service.Ref) uint {
	if ref.Owner != 0 {
		return ref.Owner
	}
	return actor
}

// ListShares godoc
//
//	@Summary		List who has access to a node, and who could still be given some
//	@Description	Candidates excludes the node's owner and any disabled account, the same filter the admin UI applies before offering a share dialog.
//	@Tags			sharing
//	@Produce		json
//	@Param			path	query		string	true	"Node path"	example(proyectos/arquitectura)
//	@Success		200		{object}	ShareListResponse
//	@Failure		400		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Router			/v1/shares [get]
func (h *handler) listShares(c *gin.Context) {
	actor := actorOf(c)
	ref := apiRef(c, c.Query("path"))

	shares, err := h.svc.ListShares(c.Request.Context(), actor, ref)
	if err != nil {
		abortWithServiceError(c, err)
		return
	}

	users, err := h.accounts.ListUsers(c.Request.Context())
	if err != nil {
		abortWithAuthError(c, err)
		return
	}
	owner := nodeOwner(actor, ref)
	candidates := make([]auth.UserInfo, 0, len(users))
	for _, u := range users {
		if u.ID == owner || !u.Active {
			continue
		}
		candidates = append(candidates, u)
	}

	c.JSON(http.StatusOK, ShareListResponse{Path: ref.Path, Shares: shares, Candidates: candidates})
}

// ShareNode godoc
//
//	@Summary		Grant or update a user's access to a node
//	@Description	Sharing again at a different level changes it in place rather than erroring: exactly one grant exists per (node, user).
//	@Tags			sharing
//	@Accept			json
//	@Produce		json
//	@Param			path	query		string			true	"Node path"	example(proyectos/arquitectura)
//	@Param			body	body		ShareRequest	true	"Who, and at what level"
//	@Success		200		{object}	service.ShareInfo
//	@Failure		400		{object}	ErrorResponse
//	@Failure		403		{object}	ErrorResponse
//	@Failure		404		{object}	ErrorResponse
//	@Failure		409		{object}	ErrorResponse
//	@Router			/v1/shares [post]
func (h *handler) shareNode(c *gin.Context) {
	var req ShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		abortWithError(c, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	ref := apiRef(c, c.Query("path"))

	info, err := h.svc.Share(c.Request.Context(), actorOf(c), ref, req.UserID, service.Access(req.Access))
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

// UnshareNode godoc
//
//	@Summary		Revoke a user's access to a node
//	@Description	The owner may revoke any grant; an editor may only revoke grants they personally created.
//	@Tags			sharing
//	@Produce		json
//	@Param			path		query	string	true	"Node path"		example(proyectos/arquitectura)
//	@Param			user_id		query	int		true	"User to revoke"
//	@Success		204			"revoked"
//	@Failure		400			{object}	ErrorResponse
//	@Failure		403			{object}	ErrorResponse
//	@Failure		404			{object}	ErrorResponse
//	@Router			/v1/shares [delete]
func (h *handler) unshareNode(c *gin.Context) {
	ref := apiRef(c, c.Query("path"))
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil || userID == 0 {
		abortWithError(c, http.StatusBadRequest, "invalid_body", "user_id is required")
		return
	}
	if err := h.svc.Unshare(c.Request.Context(), actorOf(c), ref, uint(userID)); err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ListSharedWithMe godoc
//
//	@Summary		List what other people have shared with the caller
//	@Description	Only the granted nodes themselves, not what is inside them — the same way Drive shows the shared folder rather than every file under it.
//	@Tags			sharing
//	@Produce		json
//	@Success		200	{object}	SharedResponse
//	@Router			/v1/shared [get]
func (h *handler) listSharedWithMe(c *gin.Context) {
	nodes, err := h.svc.ListSharedWithMe(c.Request.Context(), actorOf(c))
	if err != nil {
		abortWithServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, SharedResponse{Nodes: nodes})
}
