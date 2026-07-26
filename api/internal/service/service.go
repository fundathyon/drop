// Package service implements the admin tree: folders, drops, and the files a
// drop is composed of. Metadata lives in the relational store; file bytes live
// in object storage, alongside a materialized ".drop" YAML descriptor that
// keeps each published snapshot self-describing.
package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
	"gorm.io/gorm"

	"drop/internal/model"
)

var (
	ErrNotFound = errors.New("not found")
	ErrExists   = errors.New("already exists")
	// ErrEntrypointMissing means the declared entrypoint is not among the
	// uploaded files, which would publish a drop that cannot be opened.
	ErrEntrypointMissing = errors.New("entrypoint not among the uploaded files")
	ErrInvalidVisibility = errors.New("visibility must be public, unlisted or private")
	ErrNotFolder         = errors.New("not a folder")
	ErrNotDrop           = errors.New("not a drop")
	ErrIsDrop            = errors.New("path is a drop, not a plain folder")
	ErrInvalidPath       = errors.New("invalid path")
)

// ObjectStore is the slice of object storage this package needs. Defined here,
// by the consumer, so tests can substitute an in-memory double.
type ObjectStore interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	DeletePrefix(ctx context.Context, prefix string) error
}

type Service struct {
	db            *gorm.DB
	objects       ObjectStore
	publicBaseURL string
}

// New builds the service. publicBaseURL is the origin published drops are
// reachable at; it is used to build the URL returned with every drop.
func New(db *gorm.DB, store ObjectStore, publicBaseURL string) *Service {
	return &Service{
		db:            db,
		objects:       store,
		publicBaseURL: strings.TrimSuffix(publicBaseURL, "/"),
	}
}

// PublicPathPrefix is where published drops are served from, keeping them out
// of the way of /v1, /docs and /healthz.
const PublicPathPrefix = "/d/"

// publicURL is the address a drop can be opened at: always the current version.
func (s *Service) publicURL(slug string) string {
	return s.publicBaseURL + PublicPathPrefix + slug + "/"
}

// versionURL pins a specific snapshot, so a link handed out today keeps showing
// what it showed today even after the drop is republished.
func (s *Service) versionURL(slug string, seq uint) string {
	return s.publicURL(slug) + VersionRefPrefix + strconv.FormatUint(uint64(seq), 10) + "/"
}

// ---------- API-facing representations ----------

// Node is a folder or drop as seen from a directory listing.
type Node struct {
	Name string     `json:"name" example:"arquitectura"`
	Path string     `json:"path" example:"proyectos/arquitectura"`
	Kind model.Kind `json:"kind" enums:"folder,drop" example:"drop"`
}

// DropMeta is a drop's metadata as the API reports it.
type DropMeta struct {
	Title      string           `json:"title" example:"Arquitectura del sistema"`
	Slug       string           `json:"slug" example:"An1UHNyp"`
	Entrypoint string           `json:"entrypoint" example:"index.html"`
	Visibility model.Visibility `json:"visibility" enums:"public,unlisted,private" example:"public"`
	// Version is the sequence number of the snapshot currently published: 1 on
	// first upload, and one more each time the drop is uploaded again.
	Version   uint      `json:"version" example:"3"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// VersionInfo is one entry of a drop's history.
type VersionInfo struct {
	Seq        uint   `json:"seq" example:"2"`
	Entrypoint string `json:"entrypoint" example:"index.html"`
	Files      int    `json:"files" example:"3"`
	Size       int64  `json:"size" example:"20480"`
	// Current marks the version served at the drop's own URL.
	Current bool `json:"current" example:"true"`
	// URL pins this snapshot, and keeps working after later uploads.
	URL         string    `json:"url" example:"http://localhost:8000/d/An1UHNyp/@2/"`
	PublishedAt time.Time `json:"published_at"`
}

// FileInfo describes one file stored inside a drop.
type FileInfo struct {
	Name        string    `json:"name" example:"index.html"`
	Size        int64     `json:"size" example:"1024"`
	ContentType string    `json:"content_type" example:"text/html"`
	ModifiedAt  time.Time `json:"modified_at"`
	// Generated marks a file the system maintains — the ".drop" descriptor.
	// It can be listed and read, but not written or deleted through the API.
	Generated bool `json:"generated" example:"false"`
}

// DropDetail is a drop's identity, metadata, current file listing and history.
type DropDetail struct {
	Node
	// URL is where the drop can be opened. Serving it is subject to
	// visibility: a private drop answers 404 there.
	URL   string     `json:"url" example:"http://localhost:8000/d/An1UHNyp/"`
	Meta  DropMeta   `json:"meta"`
	Files []FileInfo `json:"files"`
	// Versions is the publication history, newest first.
	Versions []VersionInfo `json:"versions"`
}

// DropInput carries the fields accepted when creating a drop.
type DropInput struct {
	Parent     string
	Name       string
	Title      string
	Visibility model.Visibility
	Entrypoint string
}

// DropPatch carries the optional fields of a metadata update.
type DropPatch struct {
	Title      *string
	Visibility *model.Visibility
	Entrypoint *string
}

// ---------- object layout ----------

// A drop's objects are keyed by its slug, so renaming or moving a drop never
// rewrites storage; the version segment keeps each snapshot's files apart.
func dropPrefix(slug string) string { return "drops/" + slug + "/" }

func versionPrefix(slug string, seq uint) string {
	return dropPrefix(slug) + "v" + strconv.FormatUint(uint64(seq), 10) + "/"
}

func objectKey(slug string, seq uint, name string) string {
	return versionPrefix(slug, seq) + name
}

// ---------- reads ----------

func (s *Service) nodeByPath(ctx context.Context, path string) (*model.Node, error) {
	var n model.Node
	err := s.db.WithContext(ctx).Where("path = ?", path).First(&n).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// List returns the folders and drops directly under path ("" is the root).
func (s *Service) List(ctx context.Context, path string) ([]Node, error) {
	path, err := cleanPath(path)
	if err != nil {
		return nil, err
	}

	query := s.db.WithContext(ctx).Model(&model.Node{})
	if path == "" {
		query = query.Where("parent_id IS NULL")
	} else {
		parent, err := s.nodeByPath(ctx, path)
		if err != nil {
			return nil, err
		}
		if parent.Kind == model.KindDrop {
			return nil, ErrIsDrop
		}
		query = query.Where("parent_id = ?", parent.ID)
	}

	var rows []model.Node
	if err := query.Order("name").Find(&rows).Error; err != nil {
		return nil, err
	}

	nodes := make([]Node, 0, len(rows))
	for _, r := range rows {
		nodes = append(nodes, Node{Name: r.Name, Path: r.Path, Kind: r.Kind})
	}
	return nodes, nil
}

// GetDrop returns a drop's metadata, the files of its current version, and its
// publication history.
func (s *Service) GetDrop(ctx context.Context, path string) (DropDetail, error) {
	node, err := s.dropByPath(ctx, path)
	if err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node)
}

func (s *Service) dropByPath(ctx context.Context, path string) (*model.Node, error) {
	path, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, ErrNotDrop
	}
	node, err := s.nodeByPath(ctx, path)
	if err != nil {
		return nil, err
	}
	if node.Kind != model.KindDrop {
		return nil, ErrNotDrop
	}
	return node, nil
}

// currentVersion loads the snapshot a drop currently publishes. Every drop has
// one from the moment it is created, so a missing row is a broken invariant
// rather than an expected state.
func (s *Service) currentVersion(ctx context.Context, node *model.Node) (*model.Version, error) {
	if node.CurrentVersionID == nil {
		return nil, fmt.Errorf("drop %q has no current version", node.Path)
	}
	var v model.Version
	err := s.db.WithContext(ctx).Where("id = ?", *node.CurrentVersionID).First(&v).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("drop %q points at a missing version", node.Path)
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Service) versionBySeq(ctx context.Context, nodeID, seq uint) (*model.Version, error) {
	var v model.Version
	err := s.db.WithContext(ctx).Where("node_id = ? AND seq = ?", nodeID, seq).First(&v).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Service) filesOf(ctx context.Context, versionID uint) ([]model.File, error) {
	var files []model.File
	err := s.db.WithContext(ctx).Where("version_id = ?", versionID).Order("name").Find(&files).Error
	return files, err
}

// history lists a drop's versions, newest first.
func (s *Service) history(ctx context.Context, node *model.Node) ([]VersionInfo, error) {
	var versions []model.Version
	if err := s.db.WithContext(ctx).
		Where("node_id = ?", node.ID).Order("seq DESC").Find(&versions).Error; err != nil {
		return nil, err
	}

	// One aggregate for the whole history instead of a query per version.
	type totals struct {
		VersionID uint
		Files     int
		Size      int64
	}
	var rows []totals
	if err := s.db.WithContext(ctx).Model(&model.File{}).
		Select("version_id, COUNT(*) AS files, COALESCE(SUM(size), 0) AS size").
		Where("node_id = ?", node.ID).Group("version_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	byVersion := make(map[uint]totals, len(rows))
	for _, r := range rows {
		byVersion[r.VersionID] = r
	}

	out := make([]VersionInfo, 0, len(versions))
	for _, v := range versions {
		t := byVersion[v.ID]
		out = append(out, VersionInfo{
			Seq:         v.Seq,
			Entrypoint:  v.Entrypoint,
			Files:       t.Files,
			Size:        t.Size,
			Current:     node.CurrentVersionID != nil && *node.CurrentVersionID == v.ID,
			URL:         s.versionURL(node.Slug, v.Seq),
			PublishedAt: v.CreatedAt.UTC(),
		})
	}
	return out, nil
}

// ListVersions returns a drop's publication history, newest first.
func (s *Service) ListVersions(ctx context.Context, path string) ([]VersionInfo, error) {
	node, err := s.dropByPath(ctx, path)
	if err != nil {
		return nil, err
	}
	return s.history(ctx, node)
}

func (s *Service) detail(ctx context.Context, node *model.Node) (DropDetail, error) {
	version, err := s.currentVersion(ctx, node)
	if err != nil {
		return DropDetail{}, err
	}
	files, err := s.filesOf(ctx, version.ID)
	if err != nil {
		return DropDetail{}, err
	}

	// The descriptor is listed first: it is part of the drop as stored, even
	// though it has no row of its own.
	infos := make([]FileInfo, 0, len(files)+1)
	descriptor, err := s.descriptorInfo(node, version, files)
	if err != nil {
		return DropDetail{}, err
	}
	infos = append(infos, descriptor)

	for _, f := range files {
		infos = append(infos, FileInfo{
			Name:        f.Name,
			Size:        f.Size,
			ContentType: f.ContentType,
			ModifiedAt:  f.UpdatedAt.UTC(),
		})
	}

	versions, err := s.history(ctx, node)
	if err != nil {
		return DropDetail{}, err
	}

	return DropDetail{
		Node:     Node{Name: node.Name, Path: node.Path, Kind: node.Kind},
		URL:      s.publicURL(node.Slug),
		Meta:     metaOf(node, version),
		Files:    infos,
		Versions: versions,
	}, nil
}

func metaOf(n *model.Node, v *model.Version) DropMeta {
	return DropMeta{
		Title:      n.Title,
		Slug:       n.Slug,
		Entrypoint: v.Entrypoint,
		Visibility: n.Visibility,
		Version:    v.Seq,
		CreatedAt:  n.CreatedAt.UTC(),
		UpdatedAt:  n.UpdatedAt.UTC(),
	}
}

// ---------- writes ----------

// resolveParent returns the parent node for a create operation. A nil node
// means the root.
func (s *Service) resolveParent(ctx context.Context, parent string) (*model.Node, string, error) {
	parent, err := cleanPath(parent)
	if err != nil {
		return nil, "", err
	}
	if parent == "" {
		return nil, "", nil
	}
	node, err := s.nodeByPath(ctx, parent)
	if err != nil {
		return nil, "", err
	}
	if node.Kind == model.KindDrop {
		return nil, "", ErrIsDrop
	}
	return node, node.Path, nil
}

func (s *Service) exists(ctx context.Context, path string) (bool, error) {
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.Node{}).Where("path = ?", path).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// CreateFolder creates a plain organizational folder.
func (s *Service) CreateFolder(ctx context.Context, parent, name string) (Node, error) {
	if err := validName(name); err != nil {
		return Node{}, err
	}
	parentNode, parentPath, err := s.resolveParent(ctx, parent)
	if err != nil {
		return Node{}, err
	}

	path := joinPath(parentPath, name)
	taken, err := s.exists(ctx, path)
	if err != nil {
		return Node{}, err
	}
	if taken {
		return Node{}, ErrExists
	}

	node := model.Node{Name: name, Path: path, Kind: model.KindFolder}
	if parentNode != nil {
		node.ParentID = &parentNode.ID
	}
	if err := s.db.WithContext(ctx).Create(&node).Error; err != nil {
		return Node{}, err
	}
	return Node{Name: node.Name, Path: node.Path, Kind: node.Kind}, nil
}

// UploadFile is one file of an upload. Open is called only after every
// validation has passed, so a rejected request never reads a single byte.
type UploadFile struct {
	// Path is relative to the drop's root and may contain subdirectories.
	Path        string
	ContentType string
	Size        int64
	Open        func() (io.ReadCloser, error)
}

// UploadDropInput publishes a drop and its files in one call.
type UploadDropInput struct {
	Parent     string
	Name       string
	Title      string
	Entrypoint string
	Visibility model.Visibility
	Files      []UploadFile
}

// UploadDrop publishes a bundle of files. Uploading to a drop that already
// exists does not overwrite it: the files land in a new version, and the one
// published until then stays reachable at its own URL.
//
// Everything is validated up front — paths, entrypoint, destination — so a bad
// request fails before any byte is stored; and if a file fails midway, the
// half-written version is removed and the drop keeps publishing what it did
// before.
func (s *Service) UploadDrop(ctx context.Context, in UploadDropInput) (DropDetail, error) {
	if len(in.Files) == 0 {
		return DropDetail{}, fmt.Errorf("%w: at least one file is required", ErrInvalidPath)
	}
	if strings.TrimSpace(in.Title) == "" {
		return DropDetail{}, fmt.Errorf("%w: title is required", ErrInvalidPath)
	}
	if in.Name == "" {
		in.Name = slugifyName(in.Title)
	}
	if err := validName(in.Name); err != nil {
		return DropDetail{}, err
	}

	// Normalize every file path before touching storage.
	normalized := make([]UploadFile, 0, len(in.Files))
	seen := make(map[string]struct{}, len(in.Files))
	for _, f := range in.Files {
		clean, err := validFilePath(f.Path)
		if err != nil {
			return DropDetail{}, err
		}
		if _, dup := seen[clean]; dup {
			return DropDetail{}, fmt.Errorf("%w: duplicate file %q", ErrInvalidPath, clean)
		}
		seen[clean] = struct{}{}
		f.Path = clean
		normalized = append(normalized, f)
	}

	uploadedPaths := make([]string, 0, len(normalized))
	for _, f := range normalized {
		uploadedPaths = append(uploadedPaths, f.Path)
	}

	if in.Entrypoint == "" {
		entrypoint, err := inferEntrypoint(uploadedPaths)
		if err != nil {
			return DropDetail{}, err
		}
		in.Entrypoint = entrypoint
	} else {
		entrypoint, err := validFilePath(in.Entrypoint)
		if err != nil {
			return DropDetail{}, err
		}
		if _, ok := seen[entrypoint]; !ok {
			return DropDetail{}, fmt.Errorf("%w: %s", ErrEntrypointMissing, entrypoint)
		}
		in.Entrypoint = entrypoint
	}

	if in.Visibility != "" && !in.Visibility.Valid() {
		return DropDetail{}, ErrInvalidVisibility
	}

	parentNode, parentPath, err := s.resolveParent(ctx, in.Parent)
	if err != nil {
		return DropDetail{}, err
	}
	path := joinPath(parentPath, in.Name)

	// A drop already at this path is republished rather than rejected; a plain
	// folder there is a genuine collision.
	node, err := s.nodeByPath(ctx, path)
	// A drop this call created has nothing worth keeping if the upload fails —
	// unlike one that was already publishing something.
	created := errors.Is(err, ErrNotFound)
	switch {
	case created:
		visibility := in.Visibility
		if visibility == "" {
			visibility = model.VisibilityPublic
		}
		node = &model.Node{
			Name:       in.Name,
			Path:       path,
			Kind:       model.KindDrop,
			Title:      in.Title,
			Visibility: visibility,
		}
		if node.Slug, err = newSlug(); err != nil {
			return DropDetail{}, err
		}
		if parentNode != nil {
			node.ParentID = &parentNode.ID
		}
		if err := s.db.WithContext(ctx).Create(node).Error; err != nil {
			return DropDetail{}, err
		}
	case err != nil:
		return DropDetail{}, err
	case node.Kind != model.KindDrop:
		return DropDetail{}, ErrExists
	default:
		// Republishing carries the new title over. Visibility only changes when
		// the caller says so: silently reopening a private drop would be a leak.
		updates := map[string]any{"title": in.Title}
		node.Title = in.Title
		if in.Visibility != "" {
			updates["visibility"] = in.Visibility
			node.Visibility = in.Visibility
		}
		if err := s.db.WithContext(ctx).Model(node).Updates(updates).Error; err != nil {
			return DropDetail{}, err
		}
	}

	version, err := s.openVersion(ctx, node, in.Entrypoint)
	if err != nil {
		if created {
			s.db.WithContext(ctx).Delete(node)
		}
		return DropDetail{}, err
	}

	for _, f := range normalized {
		if err := s.storeUploadedFile(ctx, node, version, f); err != nil {
			// Undo the half-written version. A partially uploaded bundle is
			// worse than none, because its entrypoint may reference files that
			// never landed — and a drop that was already publishing something
			// keeps serving it.
			if delErr := s.discardVersion(ctx, node, version); delErr != nil {
				return DropDetail{}, fmt.Errorf("%w (rollback also failed: %v)", err, delErr)
			}
			if created {
				// Nothing was ever published here, so the empty drop goes too.
				if delErr := s.Delete(ctx, node.Path); delErr != nil {
					return DropDetail{}, fmt.Errorf("%w (rollback also failed: %v)", err, delErr)
				}
			}
			return DropDetail{}, err
		}
	}

	if err := s.publishVersion(ctx, node, version); err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node)
}

// openVersion starts the next snapshot of a drop. It is not published until
// every file has landed.
func (s *Service) openVersion(ctx context.Context, node *model.Node, entrypoint string) (*model.Version, error) {
	var last model.Version
	err := s.db.WithContext(ctx).Where("node_id = ?", node.ID).Order("seq DESC").First(&last).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	version := &model.Version{NodeID: node.ID, Seq: last.Seq + 1, Entrypoint: entrypoint}
	if err := s.db.WithContext(ctx).Create(version).Error; err != nil {
		return nil, err
	}
	return version, nil
}

// publishVersion points the drop at a finished snapshot and refreshes its
// descriptor.
func (s *Service) publishVersion(ctx context.Context, node *model.Node, version *model.Version) error {
	now := time.Now().UTC()
	if err := s.db.WithContext(ctx).Model(node).Updates(map[string]any{
		"current_version_id": version.ID,
		"updated_at":         now,
	}).Error; err != nil {
		return err
	}
	node.CurrentVersionID = &version.ID
	node.UpdatedAt = now
	return s.writeMeta(ctx, node, version)
}

// discardVersion removes a snapshot that never finished uploading.
func (s *Service) discardVersion(ctx context.Context, node *model.Node, version *model.Version) error {
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("version_id = ?", version.ID).Delete(&model.File{}).Error; err != nil {
			return err
		}
		return tx.Delete(version).Error
	}); err != nil {
		return err
	}
	return s.objects.DeletePrefix(ctx, versionPrefix(node.Slug, version.Seq))
}

// ActivateVersion republishes an earlier snapshot. The history is untouched:
// rolling back only moves which version the drop's URL resolves to.
func (s *Service) ActivateVersion(ctx context.Context, path string, seq uint) (DropDetail, error) {
	node, err := s.dropByPath(ctx, path)
	if err != nil {
		return DropDetail{}, err
	}
	version, err := s.versionBySeq(ctx, node.ID, seq)
	if err != nil {
		return DropDetail{}, err
	}
	if err := s.publishVersion(ctx, node, version); err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node)
}

func isHTML(p string) bool {
	lower := strings.ToLower(p)
	return strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm")
}

// inferEntrypoint picks the page to open when the caller did not declare one.
// Uploading a single page is the common case, and requiring it to be named
// index.html would be a pointless hurdle — so the lone HTML file wins.
func inferEntrypoint(paths []string) (string, error) {
	var htmls []string
	for _, p := range paths {
		if isHTML(p) {
			htmls = append(htmls, p)
		}
	}

	switch {
	case len(htmls) == 0:
		return "", fmt.Errorf("%w: no HTML file was uploaded", ErrEntrypointMissing)
	case len(htmls) == 1:
		return htmls[0], nil
	}

	// Several pages: a conventional index decides it, at the root first.
	for _, p := range htmls {
		if p == "index.html" || p == "index.htm" {
			return p, nil
		}
	}
	var indexes []string
	for _, p := range htmls {
		if base := p[strings.LastIndex(p, "/")+1:]; base == "index.html" || base == "index.htm" {
			indexes = append(indexes, p)
		}
	}
	if len(indexes) == 1 {
		return indexes[0], nil
	}

	return "", fmt.Errorf("%w: several HTML files (%s) and no index.html; declare `entrypoint`",
		ErrEntrypointMissing, strings.Join(htmls, ", "))
}

func (s *Service) storeUploadedFile(ctx context.Context, node *model.Node, version *model.Version, f UploadFile) error {
	body, err := f.Open()
	if err != nil {
		return err
	}
	defer body.Close()
	_, err = s.saveFile(ctx, node, version, f.Path, body, f.Size, f.ContentType)
	return err
}

// CreateDrop creates an empty drop: a node carrying metadata, its first
// version, and the ".drop" descriptor in object storage.
func (s *Service) CreateDrop(ctx context.Context, in DropInput) (DropDetail, error) {
	if err := validName(in.Name); err != nil {
		return DropDetail{}, err
	}
	parentNode, parentPath, err := s.resolveParent(ctx, in.Parent)
	if err != nil {
		return DropDetail{}, err
	}

	if in.Title == "" {
		in.Title = in.Name
	}
	if in.Entrypoint == "" {
		in.Entrypoint = "index.html"
	}
	if in.Visibility == "" {
		in.Visibility = model.VisibilityPublic
	}
	if !in.Visibility.Valid() {
		return DropDetail{}, ErrInvalidVisibility
	}

	path := joinPath(parentPath, in.Name)
	taken, err := s.exists(ctx, path)
	if err != nil {
		return DropDetail{}, err
	}
	if taken {
		return DropDetail{}, ErrExists
	}

	slug, err := newSlug()
	if err != nil {
		return DropDetail{}, err
	}

	node := model.Node{
		Name:       in.Name,
		Path:       path,
		Kind:       model.KindDrop,
		Title:      in.Title,
		Slug:       slug,
		Visibility: in.Visibility,
	}
	if parentNode != nil {
		node.ParentID = &parentNode.ID
	}
	if err := s.db.WithContext(ctx).Create(&node).Error; err != nil {
		return DropDetail{}, err
	}

	version, err := s.openVersion(ctx, &node, in.Entrypoint)
	if err != nil {
		s.db.WithContext(ctx).Delete(&node)
		return DropDetail{}, err
	}
	if err := s.publishVersion(ctx, &node, version); err != nil {
		// Roll back the rows so a storage outage cannot leave a drop whose
		// descriptor was never written.
		s.db.WithContext(ctx).Delete(version)
		s.db.WithContext(ctx).Delete(&node)
		return DropDetail{}, err
	}

	return s.detail(ctx, &node)
}

// UpdateDropMeta patches a drop's metadata and refreshes its descriptor. Only
// the current version is affected; sealed ones keep the entrypoint they were
// published with.
func (s *Service) UpdateDropMeta(ctx context.Context, path string, patch DropPatch) (DropDetail, error) {
	node, err := s.dropByPath(ctx, path)
	if err != nil {
		return DropDetail{}, err
	}
	version, err := s.currentVersion(ctx, node)
	if err != nil {
		return DropDetail{}, err
	}

	if patch.Title != nil {
		node.Title = *patch.Title
	}
	if patch.Visibility != nil {
		if !patch.Visibility.Valid() {
			return DropDetail{}, ErrInvalidVisibility
		}
		node.Visibility = *patch.Visibility
	}
	if err := s.db.WithContext(ctx).Save(node).Error; err != nil {
		return DropDetail{}, err
	}

	if patch.Entrypoint != nil {
		entrypoint, err := validFilePath(*patch.Entrypoint)
		if err != nil {
			return DropDetail{}, err
		}
		version.Entrypoint = entrypoint
		if err := s.db.WithContext(ctx).Model(version).Update("entrypoint", entrypoint).Error; err != nil {
			return DropDetail{}, err
		}
	}

	if err := s.writeMeta(ctx, node, version); err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node)
}

// Delete removes a folder or drop and everything beneath it, including every
// version of every drop in the subtree.
func (s *Service) Delete(ctx context.Context, path string) error {
	path, err := cleanPath(path)
	if err != nil {
		return err
	}
	if path == "" {
		return ErrInvalidPath
	}
	node, err := s.nodeByPath(ctx, path)
	if err != nil {
		return err
	}

	var subtree []model.Node
	if err := s.db.WithContext(ctx).
		Where("path = ? OR path LIKE ?", node.Path, node.Path+"/%").
		Find(&subtree).Error; err != nil {
		return err
	}

	ids := make([]uint, 0, len(subtree))
	for _, n := range subtree {
		ids = append(ids, n.ID)
	}

	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("node_id IN ?", ids).Delete(&model.File{}).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id IN ?", ids).Delete(&model.Version{}).Error; err != nil {
			return err
		}
		return tx.Where("id IN ?", ids).Delete(&model.Node{}).Error
	}); err != nil {
		return err
	}

	// Storage is cleaned after the rows are gone: an orphaned object is
	// recoverable garbage, an orphaned row is a broken drop.
	for _, n := range subtree {
		if n.Kind != model.KindDrop {
			continue
		}
		if err := s.objects.DeletePrefix(ctx, dropPrefix(n.Slug)); err != nil {
			return err
		}
	}
	return nil
}

// ---------- files ----------

// SaveFile stores a file in the drop's current version, replacing any file of
// the same name. Earlier versions are never rewritten.
func (s *Service) SaveFile(ctx context.Context, dropPath, filename string, r io.Reader, size int64, contentType string) (FileInfo, error) {
	node, err := s.dropByPath(ctx, dropPath)
	if err != nil {
		return FileInfo{}, err
	}
	version, err := s.currentVersion(ctx, node)
	if err != nil {
		return FileInfo{}, err
	}

	info, err := s.saveFile(ctx, node, version, filename, r, size, contentType)
	if err != nil {
		return FileInfo{}, err
	}
	if err := s.touch(ctx, node, version); err != nil {
		return FileInfo{}, err
	}
	return info, nil
}

// saveFile does the storing without touching the drop, so an upload of many
// files rewrites the descriptor once instead of once per file.
func (s *Service) saveFile(ctx context.Context, node *model.Node, version *model.Version, filename string, r io.Reader, size int64, contentType string) (FileInfo, error) {
	filename, err := validFilePath(filename)
	if err != nil {
		return FileInfo{}, err
	}

	contentType = resolveContentType(filename, contentType)
	key := objectKey(node.Slug, version.Seq, filename)
	if err := s.objects.Put(ctx, key, r, size, contentType); err != nil {
		return FileInfo{}, err
	}

	var file model.File
	err = s.db.WithContext(ctx).Where("version_id = ? AND name = ?", version.ID, filename).First(&file).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		file = model.File{
			NodeID:      node.ID,
			VersionID:   version.ID,
			Name:        filename,
			Size:        size,
			ContentType: contentType,
			ObjectKey:   key,
		}
		if err := s.db.WithContext(ctx).Create(&file).Error; err != nil {
			return FileInfo{}, err
		}
	case err != nil:
		return FileInfo{}, err
	default:
		file.Size = size
		file.ContentType = contentType
		file.ObjectKey = key
		if err := s.db.WithContext(ctx).Save(&file).Error; err != nil {
			return FileInfo{}, err
		}
	}

	return FileInfo{
		Name:        file.Name,
		Size:        file.Size,
		ContentType: file.ContentType,
		ModifiedAt:  file.UpdatedAt.UTC(),
	}, nil
}

// OpenFile streams a stored file. The caller closes the reader. The ".drop"
// descriptor is readable here even though it is not writable: it is part of
// what the drop stores, so it should be inspectable.
func (s *Service) OpenFile(ctx context.Context, path string) (io.ReadCloser, FileInfo, error) {
	node, version, rel, err := s.resolveFileLocation(ctx, path)
	if err != nil {
		return nil, FileInfo{}, err
	}

	if rel == MetaFileName {
		files, err := s.filesOf(ctx, version.ID)
		if err != nil {
			return nil, FileInfo{}, err
		}
		payload, err := s.descriptorBytes(node, version, files)
		if err != nil {
			return nil, FileInfo{}, err
		}
		return io.NopCloser(bytes.NewReader(payload)), descriptorFileInfo(version, payload), nil
	}

	var file model.File
	err = s.db.WithContext(ctx).
		Where("version_id = ? AND name = ?", version.ID, rel).First(&file).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, FileInfo{}, ErrNotFound
	}
	if err != nil {
		return nil, FileInfo{}, err
	}

	body, err := s.objects.Get(ctx, file.ObjectKey)
	if err != nil {
		return nil, FileInfo{}, err
	}
	return body, FileInfo{
		Name:        file.Name,
		Size:        file.Size,
		ContentType: file.ContentType,
		ModifiedAt:  file.UpdatedAt.UTC(),
	}, nil
}

// GetDropBySlug looks a drop up by its public slug. Like OpenPublicFile it
// hides private drops behind ErrNotFound.
func (s *Service) GetDropBySlug(ctx context.Context, slug string) (DropDetail, error) {
	node, err := s.publishedDrop(ctx, slug)
	if err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node)
}

// PublishedVersion describes the snapshot behind a served page: which version
// it is, and the drop it belongs to.
type PublishedVersion struct {
	Detail DropDetail
	// Seq is the version actually being served, which is the current one
	// unless the URL pinned an older snapshot.
	Seq uint
	// Pinned reports whether the URL asked for this version explicitly.
	Pinned bool
	// Files lists the served version's files, which for a pinned URL is not
	// the same set as the drop's current files.
	Files []FileInfo
}

// GetPublishedVersion resolves what a public URL is serving, for the badge
// injected into published pages.
func (s *Service) GetPublishedVersion(ctx context.Context, slug string, seq uint, pinned bool) (PublishedVersion, error) {
	node, err := s.publishedDrop(ctx, slug)
	if err != nil {
		return PublishedVersion{}, err
	}
	detail, err := s.detail(ctx, node)
	if err != nil {
		return PublishedVersion{}, err
	}

	version, err := s.resolveVersion(ctx, node, seq, pinned)
	if err != nil {
		return PublishedVersion{}, err
	}
	files := detail.Files
	if pinned {
		rows, err := s.filesOf(ctx, version.ID)
		if err != nil {
			return PublishedVersion{}, err
		}
		files = make([]FileInfo, 0, len(rows))
		for _, f := range rows {
			files = append(files, FileInfo{
				Name:        f.Name,
				Size:        f.Size,
				ContentType: f.ContentType,
				ModifiedAt:  f.UpdatedAt.UTC(),
			})
		}
	}

	return PublishedVersion{Detail: detail, Seq: version.Seq, Pinned: pinned, Files: files}, nil
}

// publishedDrop resolves a slug to a drop that may be served. Private drops
// answer ErrNotFound rather than a 403, so the response does not reveal that
// the slug exists.
func (s *Service) publishedDrop(ctx context.Context, slug string) (*model.Node, error) {
	var node model.Node
	err := s.db.WithContext(ctx).
		Where("slug = ? AND kind = ?", slug, model.KindDrop).First(&node).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if node.Visibility == model.VisibilityPrivate {
		return nil, ErrNotFound
	}
	return &node, nil
}

func (s *Service) resolveVersion(ctx context.Context, node *model.Node, seq uint, pinned bool) (*model.Version, error) {
	if pinned {
		return s.versionBySeq(ctx, node.ID, seq)
	}
	return s.currentVersion(ctx, node)
}

// OpenPublicFile serves a published drop by slug. An empty relPath resolves to
// the version's entrypoint; a leading "@<seq>" pins an older snapshot.
func (s *Service) OpenPublicFile(ctx context.Context, slug, relPath string) (io.ReadCloser, FileInfo, error) {
	node, err := s.publishedDrop(ctx, slug)
	if err != nil {
		return nil, FileInfo{}, err
	}

	seq, rest, pinned := SplitVersionRef(relPath)
	version, err := s.resolveVersion(ctx, node, seq, pinned)
	if err != nil {
		return nil, FileInfo{}, err
	}

	if rest == "" {
		rest = version.Entrypoint
	}
	clean, err := validFilePath(rest)
	if err != nil {
		return nil, FileInfo{}, err
	}

	var file model.File
	err = s.db.WithContext(ctx).
		Where("version_id = ? AND name = ?", version.ID, clean).First(&file).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, FileInfo{}, ErrNotFound
	}
	if err != nil {
		return nil, FileInfo{}, err
	}

	body, err := s.objects.Get(ctx, file.ObjectKey)
	if err != nil {
		return nil, FileInfo{}, err
	}
	return body, FileInfo{
		Name:        file.Name,
		Size:        file.Size,
		ContentType: file.ContentType,
		ModifiedAt:  file.UpdatedAt.UTC(),
	}, nil
}

// DeleteFile removes one file from a drop's current version.
func (s *Service) DeleteFile(ctx context.Context, path string) error {
	node, version, rel, err := s.resolveFileLocation(ctx, path)
	if err != nil {
		return err
	}
	if rel == MetaFileName {
		return ErrNotFound
	}

	var file model.File
	err = s.db.WithContext(ctx).
		Where("version_id = ? AND name = ?", version.ID, rel).First(&file).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if err := s.db.WithContext(ctx).Delete(&file).Error; err != nil {
		return err
	}
	if err := s.objects.Delete(ctx, file.ObjectKey); err != nil {
		return err
	}
	return s.touch(ctx, node, version)
}

// resolveFileLocation splits a full path into the drop that owns it, the drop's
// current version, and the path of the file within that version. Because files
// may sit in subdirectories, the split point is not simply the last "/": it is
// the longest prefix that is an actual drop node. Drops cannot nest, so at most
// one prefix can match.
func (s *Service) resolveFileLocation(ctx context.Context, full string) (*model.Node, *model.Version, string, error) {
	cleaned, err := cleanPath(full)
	if err != nil {
		return nil, nil, "", err
	}
	segments := strings.Split(cleaned, "/")
	if len(segments) < 2 {
		return nil, nil, "", ErrNotFound
	}

	for i := len(segments) - 1; i >= 1; i-- {
		node, err := s.nodeByPath(ctx, strings.Join(segments[:i], "/"))
		if errors.Is(err, ErrNotFound) {
			continue // an intermediate directory inside the drop, not a node
		}
		if err != nil {
			return nil, nil, "", err
		}
		if node.Kind != model.KindDrop {
			return nil, nil, "", ErrNotDrop
		}
		version, err := s.currentVersion(ctx, node)
		if err != nil {
			return nil, nil, "", err
		}
		return node, version, strings.Join(segments[i:], "/"), nil
	}
	return nil, nil, "", ErrNotFound
}

// ---------- ".drop" descriptor ----------

// dropDescriptor is the ".drop" file: everything needed to make sense of a
// bundle pulled straight out of storage, without the database that produced it.
type dropDescriptor struct {
	Title      string           `yaml:"title"`
	Slug       string           `yaml:"slug"`
	Entrypoint string           `yaml:"entrypoint"`
	Visibility model.Visibility `yaml:"visibility"`
	Version    uint             `yaml:"version"`
	CreatedAt  time.Time        `yaml:"created_at"`
	UpdatedAt  time.Time        `yaml:"updated_at"`
	Files      []descriptorFile `yaml:"files"`
}

type descriptorFile struct {
	Path        string `yaml:"path"`
	Size        int64  `yaml:"size"`
	ContentType string `yaml:"content_type"`
}

// descriptorBytes renders a drop's descriptor. Everything that serves, sizes or
// stores the ".drop" goes through this one function: taking its bytes from
// storage while computing its size from the database let the two drift, and a
// Content-Length longer than the body truncates every download of it.
func (s *Service) descriptorBytes(node *model.Node, version *model.Version, files []model.File) ([]byte, error) {
	listing := make([]descriptorFile, 0, len(files))
	for _, f := range files {
		listing = append(listing, descriptorFile{
			Path:        f.Name,
			Size:        f.Size,
			ContentType: f.ContentType,
		})
	}
	return yaml.Marshal(dropDescriptor{
		Title:      node.Title,
		Slug:       node.Slug,
		Entrypoint: version.Entrypoint,
		Visibility: node.Visibility,
		Version:    version.Seq,
		CreatedAt:  node.CreatedAt.UTC(),
		UpdatedAt:  node.UpdatedAt.UTC(),
		Files:      listing,
	})
}

// descriptorFileInfo describes a rendered descriptor, sized from the very bytes
// it was rendered into.
func descriptorFileInfo(version *model.Version, payload []byte) FileInfo {
	return FileInfo{
		Name:        MetaFileName,
		Size:        int64(len(payload)),
		ContentType: "application/yaml",
		ModifiedAt:  version.UpdatedAt.UTC(),
		Generated:   true,
	}
}

func (s *Service) descriptorInfo(node *model.Node, version *model.Version, files []model.File) (FileInfo, error) {
	payload, err := s.descriptorBytes(node, version, files)
	if err != nil {
		return FileInfo{}, err
	}
	return descriptorFileInfo(version, payload), nil
}

// writeMeta mirrors the descriptor next to the version's files, so a bundle
// pulled straight out of storage still describes itself.
func (s *Service) writeMeta(ctx context.Context, node *model.Node, version *model.Version) error {
	files, err := s.filesOf(ctx, version.ID)
	if err != nil {
		return err
	}
	payload, err := s.descriptorBytes(node, version, files)
	if err != nil {
		return err
	}
	return s.objects.Put(ctx, objectKey(node.Slug, version.Seq, MetaFileName),
		bytes.NewReader(payload), int64(len(payload)), "application/yaml")
}

// touch records that a version's contents changed and refreshes its descriptor.
// It does not open a new version: snapshots are cut by uploads, not by edits.
func (s *Service) touch(ctx context.Context, node *model.Node, version *model.Version) error {
	now := time.Now().UTC()
	if err := s.db.WithContext(ctx).Model(version).Update("updated_at", now).Error; err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Model(node).Update("updated_at", now).Error; err != nil {
		return err
	}
	version.UpdatedAt = now
	node.UpdatedAt = now
	return s.writeMeta(ctx, node, version)
}

// ---------- version references in public URLs ----------

// VersionRefPrefix marks a pinned version inside a public URL: /d/{slug}/@2/.
// Uploads reject file paths starting with it, so a real file can never shadow
// a version reference.
const VersionRefPrefix = "@"

// SplitVersionRef pulls a leading "@<seq>" out of a public path, returning the
// version asked for and the rest of the path.
func SplitVersionRef(relPath string) (seq uint, rest string, ok bool) {
	if !strings.HasPrefix(relPath, VersionRefPrefix) {
		return 0, relPath, false
	}
	ref := strings.TrimPrefix(relPath, VersionRefPrefix)
	rest = ""
	if i := strings.Index(ref, "/"); i >= 0 {
		ref, rest = ref[:i], ref[i+1:]
	}
	n, err := strconv.ParseUint(ref, 10, 32)
	if err != nil || n == 0 {
		return 0, relPath, false
	}
	return uint(n), rest, true
}

// ---------- slugs ----------

const slugAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

func newSlug() (string, error) {
	const n = 8
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, n)
	for i, b := range buf {
		out[i] = slugAlphabet[int(b)%len(slugAlphabet)]
	}
	return string(out), nil
}
