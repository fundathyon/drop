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
	if err := g.AutoMigrate(&model.Node{}, &model.File{}); err != nil {
		return nil, fmt.Errorf("migrate schema: %w", err)
	}
	return g, nil
}
