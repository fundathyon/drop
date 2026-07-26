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
	ID       uint   `gorm:"primaryKey"`
	ParentID *uint  `gorm:"index"`
	Name     string `gorm:"not null;size:255"`
	// Path is the materialized slash-separated path from the root, e.g.
	// "proyectos/arquitectura". Unique, so it also enforces "no two children
	// with the same name" without relying on NULL-tolerant composite indexes.
	Path string `gorm:"not null;uniqueIndex;size:1024"`
	Kind Kind   `gorm:"not null;size:16;index"`

	// Drop-only metadata, mirrored into the drop's ".drop" object.
	Title      string     `gorm:"size:255"`
	Slug       string     `gorm:"size:32;index"`
	Entrypoint string     `gorm:"size:255"`
	Visibility Visibility `gorm:"size:16"`

	CreatedAt time.Time
	UpdatedAt time.Time

	Files []File `gorm:"foreignKey:NodeID;constraint:OnDelete:CASCADE"`
}

// File is a single object stored inside a drop. Bytes live in object storage;
// this row is the index entry.
type File struct {
	ID     uint `gorm:"primaryKey"`
	NodeID uint `gorm:"not null;uniqueIndex:idx_file_node_name"`
	// Name is the path relative to the drop's root, so it may contain
	// subdirectories ("assets/app.css") — hence the generous length.
	Name string `gorm:"not null;size:1024;uniqueIndex:idx_file_node_name"`
	Size        int64
	ContentType string `gorm:"size:255"`
	// ObjectKey is the key under which the bytes are stored in the bucket.
	ObjectKey string `gorm:"not null;size:1024"`

	CreatedAt time.Time
	UpdatedAt time.Time
}
