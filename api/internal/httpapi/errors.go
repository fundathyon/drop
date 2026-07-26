package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"drop/internal/objects"
	"drop/internal/service"
)

func abortWithError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, ErrorResponse{Code: code, Message: message})
}

// abortWithServiceError translates a domain error into its HTTP shape. This is
// the only place that knows about status codes.
func abortWithServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound), errors.Is(err, objects.ErrNotFound):
		abortWithError(c, http.StatusNotFound, "not_found", "resource not found")
	case errors.Is(err, service.ErrExists):
		abortWithError(c, http.StatusConflict, "already_exists", "a node with that name already exists")
	case errors.Is(err, service.ErrIsDrop):
		abortWithError(c, http.StatusConflict, "is_drop", "path is a drop; use the drops endpoints")
	case errors.Is(err, service.ErrInvalidVisibility):
		abortWithError(c, http.StatusBadRequest, "invalid_visibility", err.Error())
	case errors.Is(err, service.ErrEntrypointMissing):
		abortWithError(c, http.StatusUnprocessableEntity, "entrypoint_missing", err.Error())
	case errors.Is(err, service.ErrNotDrop):
		abortWithError(c, http.StatusUnprocessableEntity, "not_drop", "path is not a drop")
	case errors.Is(err, service.ErrNotFolder):
		abortWithError(c, http.StatusUnprocessableEntity, "not_folder", "path is not a folder")
	case errors.Is(err, service.ErrInvalidPath):
		abortWithError(c, http.StatusBadRequest, "invalid_path", "invalid path or name")
	case errors.Is(err, service.ErrForbidden):
		// Distinct from not_found on purpose: this one is reached only once the
		// caller can already see the thing exists, so saying so leaks nothing.
		abortWithError(c, http.StatusForbidden, "forbidden", "not allowed on this resource")
	case errors.Is(err, service.ErrCannotShareWithSelf):
		abortWithError(c, http.StatusConflict, "already_owner", "the owner already has access")
	default:
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, "internal_error", "unexpected error")
	}
}
