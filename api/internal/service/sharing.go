package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"drop/internal/model"
)

// ErrCannotShareWithSelf rejects the grant that would do nothing: the owner
// already has everything a share could give them.
var ErrCannotShareWithSelf = errors.New("cannot share with the owner")

// SharedNode is an entry of "shared with me": what was granted, by whom, and
// at what level.
type SharedNode struct {
	Node
	// Access is what the grant allows: viewer or editor.
	Access Access `json:"access" enums:"viewer,editor" example:"viewer"`
	// OwnerName and OwnerEmail identify whose drive it lives in, because a
	// path alone says nothing about that.
	OwnerName  string    `json:"owner_name" example:"Rafa"`
	OwnerEmail string    `json:"owner_email" example:"rafa@ejemplo.com"`
	SharedAt   time.Time `json:"shared_at"`
}

// ShareInfo is one grant on a node, as the owner sees it.
type ShareInfo struct {
	ID     uint   `json:"id" example:"1"`
	UserID uint   `json:"user_id" example:"2"`
	Name   string `json:"name" example:"Rafa"`
	Email  string `json:"email" example:"rafa@ejemplo.com"`
	Access Access `json:"access" enums:"viewer,editor" example:"viewer"`
	// CreatedByID is who granted it, which is what lets an editor tell their
	// own grants apart from the owner's.
	CreatedByID uint      `json:"created_by_id" example:"1"`
	CreatedAt   time.Time `json:"created_at"`
}

// ListSharedWithMe returns what other people granted the actor.
//
// Only the granted nodes themselves are listed, not what is inside them: this
// is the top of a section someone browses into, the same way Drive shows the
// shared folder rather than every file under it.
func (s *Service) ListSharedWithMe(ctx context.Context, actor uint) ([]SharedNode, error) {
	type row struct {
		Name       string
		Path       string
		Kind       model.Kind
		OwnerID    uint
		Access     string
		OwnerName  string
		OwnerEmail string
		CreatedAt  time.Time
	}

	var rows []row
	err := s.db.WithContext(ctx).
		Table("shares").
		Select(`nodes.name AS name, nodes.path AS path, nodes.kind AS kind,
		        nodes.owner_id AS owner_id, shares.access AS access,
		        users.name AS owner_name, users.email AS owner_email,
		        shares.created_at AS created_at`).
		Joins("JOIN nodes ON nodes.id = shares.node_id").
		Joins("JOIN users ON users.id = nodes.owner_id").
		Where("shares.user_id = ? AND users.deleted_at IS NULL", actor).
		Order("shares.created_at DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	out := make([]SharedNode, 0, len(rows))
	for _, r := range rows {
		out = append(out, SharedNode{
			Node:       Node{Name: r.Name, Path: r.Path, Kind: r.Kind, Owner: r.OwnerID},
			Access:     Access(r.Access),
			OwnerName:  r.OwnerName,
			OwnerEmail: r.OwnerEmail,
			SharedAt:   r.CreatedAt.UTC(),
		})
	}
	return out, nil
}

// ListShares returns who has access to a node. Only someone who could grant
// access gets to see who has it.
func (s *Service) ListShares(ctx context.Context, actor uint, ref Ref) ([]ShareInfo, error) {
	node, level, err := s.readable(ctx, actor, ref)
	if err != nil {
		return nil, err
	}
	if !level.CanShare() {
		return nil, ErrForbidden
	}
	return s.sharesOf(ctx, node.ID)
}

func (s *Service) sharesOf(ctx context.Context, nodeID uint) ([]ShareInfo, error) {
	type row struct {
		ID          uint
		UserID      uint
		Access      string
		CreatedByID uint
		CreatedAt   time.Time
		Name        string
		Email       string
	}

	var rows []row
	err := s.db.WithContext(ctx).
		Table("shares").
		Select(`shares.id AS id, shares.user_id AS user_id, shares.access AS access,
		        shares.created_by_id AS created_by_id, shares.created_at AS created_at,
		        users.name AS name, users.email AS email`).
		Joins("JOIN users ON users.id = shares.user_id").
		Where("shares.node_id = ? AND users.deleted_at IS NULL", nodeID).
		Order("users.email").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	out := make([]ShareInfo, 0, len(rows))
	for _, r := range rows {
		out = append(out, ShareInfo{
			ID: r.ID, UserID: r.UserID, Name: r.Name, Email: r.Email,
			Access: Access(r.Access), CreatedByID: r.CreatedByID,
			CreatedAt: r.CreatedAt.UTC(),
		})
	}
	return out, nil
}

// Share grants a user access to a node and everything under it.
//
// Editors may share as well as owners, so a team is not bottlenecked on one
// person — but an editor can only pass on what they were given, and never at a
// level above their own.
func (s *Service) Share(ctx context.Context, actor uint, ref Ref, userID uint, access Access) (ShareInfo, error) {
	if !model.Access(access).Valid() {
		return ShareInfo{}, fmt.Errorf("%w: access must be viewer or editor", ErrInvalidPath)
	}

	node, level, err := s.readable(ctx, actor, ref)
	if err != nil {
		return ShareInfo{}, err
	}
	if !level.CanShare() {
		return ShareInfo{}, ErrForbidden
	}
	if userID == 0 || userID == node.OwnerID {
		return ShareInfo{}, ErrCannotShareWithSelf
	}

	var user model.User
	if err := s.db.WithContext(ctx).First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ShareInfo{}, ErrNotFound
		}
		return ShareInfo{}, err
	}

	// Re-granting is how a level is changed, so an existing row is updated
	// rather than rejected as a duplicate.
	var existing model.Share
	err = s.db.WithContext(ctx).
		Where("node_id = ? AND user_id = ?", node.ID, userID).First(&existing).Error
	switch {
	case err == nil:
		if err := s.db.WithContext(ctx).Model(&existing).
			Update("access", model.Access(access)).Error; err != nil {
			return ShareInfo{}, err
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		existing = model.Share{
			NodeID: node.ID, UserID: userID,
			Access: model.Access(access), CreatedByID: actor,
		}
		if err := s.db.WithContext(ctx).Create(&existing).Error; err != nil {
			return ShareInfo{}, err
		}
	default:
		return ShareInfo{}, err
	}

	return ShareInfo{
		ID: existing.ID, UserID: userID, Name: user.Name, Email: user.Email,
		Access: access, CreatedByID: existing.CreatedByID,
		CreatedAt: existing.CreatedAt.UTC(),
	}, nil
}

// Unshare revokes a grant. The owner may revoke any of them; an editor only
// the ones they made, so nobody can quietly undo the owner's decisions.
func (s *Service) Unshare(ctx context.Context, actor uint, ref Ref, userID uint) error {
	node, level, err := s.readable(ctx, actor, ref)
	if err != nil {
		return err
	}
	if !level.CanShare() {
		return ErrForbidden
	}

	var share model.Share
	err = s.db.WithContext(ctx).
		Where("node_id = ? AND user_id = ?", node.ID, userID).First(&share).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if level != AccessOwner && share.CreatedByID != actor {
		return ErrForbidden
	}
	return s.db.WithContext(ctx).Delete(&share).Error
}

// RevokeSharesForUser drops every grant to and from a user, so deleting an
// account does not leave rows pointing at nobody.
func (s *Service) RevokeSharesForUser(ctx context.Context, userID uint) error {
	return s.db.WithContext(ctx).
		Where("user_id = ? OR created_by_id = ?", userID, userID).
		Delete(&model.Share{}).Error
}
