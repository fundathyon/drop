package db

import (
	"gorm.io/gorm"

	"drop/internal/model"
)

// backfillVersions upgrades a database written before drops had a history:
// every existing drop becomes version 1, owning the files it already had.
//
// Nothing moves in object storage. Each file row carries the key its bytes were
// written under, so files stored before the version segment existed keep
// resolving; only the files written from now on land under "v{seq}/".
func backfillVersions(g *gorm.DB) error {
	// The entrypoint used to live on the drop and now belongs to the version,
	// so it is read from the column the previous schema left behind.
	type legacyDrop struct {
		ID         uint
		Entrypoint string
	}

	var drops []legacyDrop
	if err := g.Raw(
		`SELECT id, COALESCE(entrypoint, '') AS entrypoint
		   FROM nodes
		  WHERE kind = ? AND current_version_id IS NULL`,
		model.KindDrop,
	).Scan(&drops).Error; err != nil {
		return err
	}

	for _, d := range drops {
		entrypoint := d.Entrypoint
		if entrypoint == "" {
			entrypoint = "index.html"
		}

		if err := g.Transaction(func(tx *gorm.DB) error {
			version := model.Version{NodeID: d.ID, Seq: 1, Entrypoint: entrypoint}
			if err := tx.Create(&version).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.File{}).Where("node_id = ?", d.ID).
				Update("version_id", version.ID).Error; err != nil {
				return err
			}
			return tx.Model(&model.Node{}).Where("id = ?", d.ID).
				Update("current_version_id", version.ID).Error
		}); err != nil {
			return err
		}
	}
	return nil
}
