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

	// Ownership arrived after the tree did. SQLite refuses a NOT NULL column
	// without a default on a table that already has rows, so the column is
	// added here with a placeholder; AdoptOwnerlessNodes replaces it once
	// there is an administrator to hand the tree to.
	if g.Migrator().HasTable(&model.Node{}) && !g.Migrator().HasColumn(&model.Node{}, "owner_id") {
		if err := g.Exec("ALTER TABLE nodes ADD COLUMN owner_id integer NOT NULL DEFAULT 0").Error; err != nil {
			return nil, fmt.Errorf("add owner column: %w", err)
		}
	}

	// Organizations arrived after users did. Same placeholder-then-backfill
	// shape as owner_id above; auth.Service.BackfillOrganizations replaces it
	// once there is an organization to hand every account to.
	if g.Migrator().HasTable(&model.User{}) && !g.Migrator().HasColumn(&model.User{}, "organization_id") {
		if err := g.Exec("ALTER TABLE users ADD COLUMN organization_id integer NOT NULL DEFAULT 0").Error; err != nil {
			return nil, fmt.Errorf("add organization column: %w", err)
		}
	}

	if err := g.AutoMigrate(
		&model.Organization{},
		&model.Node{}, &model.Version{}, &model.File{},
		&model.User{}, &model.Session{}, &model.Invitation{}, &model.Share{},
	); err != nil {
		return nil, fmt.Errorf("migrate schema: %w", err)
	}

	// The old schema made a path unique across the whole table. Two people may
	// now each have a "Proyectos", so that index has to go — AutoMigrate adds
	// the composite one but never drops what it replaced.
	//
	// Safe in either order: paths were globally unique before, so they are
	// still unique per owner while every row shares the placeholder owner.
	if err := g.Exec("DROP INDEX IF EXISTS idx_nodes_path").Error; err != nil {
		return nil, fmt.Errorf("drop legacy path index: %w", err)
	}

	return g, nil
}

// AdoptOwnerlessNodes hands the tree from before ownership existed to one user.
//
// It runs after the administrator is bootstrapped rather than inside Open,
// because a database written before there were accounts has nodes and no user
// to give them to yet. Nodes created from now on always carry their owner, so
// on any other startup this matches nothing.
func AdoptOwnerlessNodes(g *gorm.DB, ownerID uint) (int64, error) {
	if ownerID == 0 {
		return 0, fmt.Errorf("adopt nodes: no owner given")
	}
	result := g.Model(&model.Node{}).Where("owner_id = 0 OR owner_id IS NULL").
		Update("owner_id", ownerID)
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
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
