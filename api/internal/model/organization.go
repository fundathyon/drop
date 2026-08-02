package model

import "time"

// Organization is the tenant every account belongs to. Today there is always
// exactly one: it exists so accounts have somewhere to belong from day one,
// not because anything else in Drop is scoped by it yet.
type Organization struct {
	ID   uint   `gorm:"primaryKey"`
	Name string `gorm:"not null;size:255"`

	CreatedAt time.Time
	UpdatedAt time.Time
}
