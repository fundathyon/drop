// Package db opens the relational store and keeps its schema current.
package db

import (
	"fmt"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"drop/internal/model"
)

// Open connects to SQLite and applies the schema. The driver is pure Go, so
// no cgo toolchain is needed to build or containerize the API. Swapping to
// Postgres later is a change of driver here, not of the models.
func Open(dsn string) (*gorm.DB, error) {
	g, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := g.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	// A database written before drops had a history needs its rows reshaped
	// before the new constraints can hold. Detected before the migration,
	// which is what creates the versions table.
	if g.Migrator().HasTable(&model.Node{}) && !g.Migrator().HasTable(&model.Version{}) {
		if err := upgradeToVersionedDrops(g); err != nil {
			return nil, fmt.Errorf("upgrade schema: %w", err)
		}
	}

	if err := g.AutoMigrate(
		&model.Node{}, &model.Version{}, &model.File{},
		&model.User{}, &model.Session{}, &model.Invitation{},
	); err != nil {
		return nil, fmt.Errorf("migrate schema: %w", err)
	}
	return g, nil
}

// upgradeToVersionedDrops moves an existing database onto the versioned schema.
//
// It cannot be left to AutoMigrate, which would do the two halves in the wrong
// order: it adds `files.version_id` and its unique index in one step, and every
// existing row would still hold the placeholder zero at that point, so the
// first two drops sharing an "index.html" would collide. The column is added
// here, the rows are backfilled, and only then does AutoMigrate get to index
// them.
func upgradeToVersionedDrops(g *gorm.DB) error {
	if err := g.AutoMigrate(&model.Version{}); err != nil {
		return err
	}

	// SQLite refuses a NOT NULL column without a default on a populated table,
	// hence the placeholder that the backfill immediately replaces.
	if !g.Migrator().HasColumn(&model.File{}, "version_id") {
		if err := g.Exec("ALTER TABLE files ADD COLUMN version_id integer NOT NULL DEFAULT 0").Error; err != nil {
			return err
		}
	}
	if !g.Migrator().HasColumn(&model.Node{}, "current_version_id") {
		if err := g.Exec("ALTER TABLE nodes ADD COLUMN current_version_id integer").Error; err != nil {
			return err
		}
	}

	// Files used to be unique per (drop, name); they are now unique per
	// (version, name), because two versions of a drop each have an index.html.
	if err := g.Exec("DROP INDEX IF EXISTS idx_file_node_name").Error; err != nil {
		return err
	}

	return backfillVersions(g)
}
