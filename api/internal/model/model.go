// Package model holds the GORM entities backing the admin tree.
package model

import "time"

// Kind distinguishes a plain organizational folder from a drop.
type Kind string

const (
	KindFolder Kind = "folder"
	KindDrop   Kind = "drop"
)

type Visibility string

const (
	VisibilityPublic   Visibility = "public"
	VisibilityUnlisted Visibility = "unlisted"
	VisibilityPrivate  Visibility = "private"
)

// Valid reports whether v is one of the supported visibilities.
func (v Visibility) Valid() bool {
	switch v {
	case VisibilityPublic, VisibilityUnlisted, VisibilityPrivate:
		return true
	default:
		return false
	}
}

// Node is a folder or a drop. Both live in one table because the admin tree
// is navigated uniformly; Kind decides which of the drop-only columns apply.
type Node struct {
	ID uint `gorm:"primaryKey"`
	// OwnerID is whose drive this belongs to. Every tree is rooted in a user:
	// there is no shared global namespace, and two people may each have their
	// own "Proyectos" without colliding.
	OwnerID  uint   `gorm:"not null;index;uniqueIndex:idx_nodes_owner_path"`
	ParentID *uint  `gorm:"index"`
	Name     string `gorm:"not null;size:255"`
	// Path is the materialized slash-separated path from the owner's root, e.g.
	// "proyectos/arquitectura". Unique per owner, so it also enforces "no two
	// children with the same name" without relying on NULL-tolerant indexes.
	Path string `gorm:"not null;uniqueIndex:idx_nodes_owner_path;size:1024"`
	Kind Kind   `gorm:"not null;size:16;index"`

	// Drop-only metadata. What the drop *is* lives here; what it *contains*
	// belongs to a Version, because contents are what a new upload replaces.
	Title      string     `gorm:"size:255"`
	Slug       string     `gorm:"size:32;index"`
	Visibility Visibility `gorm:"size:16"`
	// CurrentVersionID is the snapshot served at the drop's public URL. The
	// older ones stay in the table, each reachable at its own URL.
	CurrentVersionID *uint `gorm:"index"`

	CreatedAt time.Time
	UpdatedAt time.Time

	Versions []Version `gorm:"foreignKey:NodeID;constraint:OnDelete:CASCADE"`
}

// Access is what a share grants. Ownership is not one of these: it is not
// granted, it is where a node came from.
type Access string

const (
	// AccessViewer can open and download, and nothing else.
	AccessViewer Access = "viewer"
	// AccessEditor can also upload, edit and delete inside what was shared —
	// but not delete the shared node itself, which is the one thing an editor
	// could do by accident that the owner could not undo.
	AccessEditor Access = "editor"
)

func (a Access) Valid() bool {
	switch a {
	case AccessViewer, AccessEditor:
		return true
	default:
		return false
	}
}

// Share grants a user access to a node and everything beneath it.
//
// Grants are stored against the node they were made on, not expanded over the
// subtree: moving or growing a folder must not mean rewriting permissions, and
// a grant that no longer applies is one row to delete rather than many.
type Share struct {
	ID     uint `gorm:"primaryKey"`
	NodeID uint `gorm:"not null;index;uniqueIndex:idx_shares_node_user"`
	// UserID is who was granted access. Indexed on its own because "what has
	// been shared with me" is the query behind a whole section of the admin.
	UserID uint   `gorm:"not null;index;uniqueIndex:idx_shares_node_user"`
	Access Access `gorm:"not null;size:16"`
	// CreatedByID is who granted it. Editors may share too, and this is what
	// lets them revoke their own grants without touching the owner's.
	CreatedByID uint `gorm:"index"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

// Version is one published snapshot of a drop's files. Uploading a drop that
// already exists seals the current snapshot and opens the next one, so what
// was published before stays reachable exactly as it was.
type Version struct {
	ID     uint `gorm:"primaryKey"`
	NodeID uint `gorm:"not null;uniqueIndex:idx_version_node_seq"`
	// Seq numbers a drop's versions from 1, in publication order.
	Seq uint `gorm:"not null;uniqueIndex:idx_version_node_seq"`
	// Entrypoint belongs to the snapshot rather than to the drop: a later
	// upload may well open a different page.
	Entrypoint string `gorm:"size:255"`

	CreatedAt time.Time
	UpdatedAt time.Time

	Files []File `gorm:"foreignKey:VersionID;constraint:OnDelete:CASCADE"`
}

// File is a single object stored inside one version of a drop. Bytes live in
// object storage; this row is the index entry.
type File struct {
	ID uint `gorm:"primaryKey"`
	// NodeID is the drop the file belongs to, denormalized so a drop's files
	// can be found across every version without joining.
	NodeID uint `gorm:"not null;index"`
	// VersionID is the snapshot this file is part of. Two versions of the same
	// drop each have their own "index.html", hence the index on version rather
	// than on drop.
	VersionID uint `gorm:"not null;uniqueIndex:idx_file_version_name"`
	// Name is the path relative to the version's root, so it may contain
	// subdirectories ("assets/app.css") — hence the generous length.
	Name        string `gorm:"not null;size:1024;uniqueIndex:idx_file_version_name"`
	Size        int64
	ContentType string `gorm:"size:255"`
	// ObjectKey is the key under which the bytes are stored in the bucket.
	ObjectKey string `gorm:"not null;size:1024"`

	CreatedAt time.Time
	UpdatedAt time.Time
}
