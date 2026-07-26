// Package service implements the admin tree: folders, drops, and the files a
// drop is composed of. Metadata lives in the relational store; file bytes live
// in object storage, alongside a materialized ".drop" YAML descriptor that
// keeps each drop self-describing.
package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
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
	db      *gorm.DB
	objects ObjectStore
}

func New(db *gorm.DB, store ObjectStore) *Service {
	return &Service{db: db, objects: store}
}

// ---------- API-facing representations ----------

// Node is a folder or drop as seen from a directory listing.
type Node struct {
	Name string     `json:"name" example:"arquitectura"`
	Path string     `json:"path" example:"proyectos/arquitectura"`
	Kind model.Kind `json:"kind" enums:"folder,drop" example:"drop"`
}

// DropMeta is the metadata stored in a drop's ".drop" file.
type DropMeta struct {
	Title      string           `json:"title" yaml:"title" example:"Arquitectura del sistema"`
	Slug       string           `json:"slug" yaml:"slug" example:"An1UHNyp"`
	Entrypoint string           `json:"entrypoint" yaml:"entrypoint" example:"index.html"`
	Visibility model.Visibility `json:"visibility" yaml:"visibility" enums:"public,unlisted,private" example:"public"`
	CreatedAt  time.Time        `json:"created_at" yaml:"created_at"`
	UpdatedAt  time.Time        `json:"updated_at" yaml:"updated_at"`
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

// DropDetail is a drop's identity, metadata, and file listing.
type DropDetail struct {
	Node
	Meta  DropMeta   `json:"meta"`
	Files []FileInfo `json:"files"`
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
// rewrites storage.
func dropPrefix(slug string) string      { return "drops/" + slug + "/" }
func objectKey(slug, name string) string { return dropPrefix(slug) + name }

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

// GetDrop returns a drop's metadata and the files it is composed of.
func (s *Service) GetDrop(ctx context.Context, path string) (DropDetail, error) {
	path, err := cleanPath(path)
	if err != nil {
		return DropDetail{}, err
	}
	if path == "" {
		return DropDetail{}, ErrNotDrop
	}
	node, err := s.nodeByPath(ctx, path)
	if err != nil {
		return DropDetail{}, err
	}
	if node.Kind != model.KindDrop {
		return DropDetail{}, ErrNotDrop
	}
	return s.detail(ctx, node)
}

func (s *Service) detail(ctx context.Context, node *model.Node) (DropDetail, error) {
	var files []model.File
	if err := s.db.WithContext(ctx).Where("node_id = ?", node.ID).Order("name").Find(&files).Error; err != nil {
		return DropDetail{}, err
	}

	// The descriptor is listed first: it is part of the drop as stored, even
	// though it has no row of its own.
	infos := make([]FileInfo, 0, len(files)+1)
	meta, err := s.metaFileInfo(node)
	if err != nil {
		return DropDetail{}, err
	}
	infos = append(infos, meta)

	for _, f := range files {
		infos = append(infos, FileInfo{
			Name:        f.Name,
			Size:        f.Size,
			ContentType: f.ContentType,
			ModifiedAt:  f.UpdatedAt.UTC(),
		})
	}

	return DropDetail{
		Node:  Node{Name: node.Name, Path: node.Path, Kind: node.Kind},
		Meta:  metaOf(node),
		Files: infos,
	}, nil
}

// metaFileInfo describes the ".drop" descriptor as it appears in a listing.
// Its size is the YAML that writeMeta would produce, so the number shown is
// the number of bytes actually stored.
func (s *Service) metaFileInfo(node *model.Node) (FileInfo, error) {
	payload, err := yaml.Marshal(metaOf(node))
	if err != nil {
		return FileInfo{}, err
	}
	return FileInfo{
		Name:        MetaFileName,
		Size:        int64(len(payload)),
		ContentType: "application/yaml",
		ModifiedAt:  node.UpdatedAt.UTC(),
		Generated:   true,
	}, nil
}

func metaOf(n *model.Node) DropMeta {
	return DropMeta{
		Title:      n.Title,
		Slug:       n.Slug,
		Entrypoint: n.Entrypoint,
		Visibility: n.Visibility,
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

// UploadDropInput creates a drop and its files in one call.
type UploadDropInput struct {
	Parent     string
	Name       string
	Title      string
	Entrypoint string
	Visibility model.Visibility
	Files      []UploadFile
}

// UploadDrop creates a drop together with its files. Everything is validated
// up front — paths, entrypoint, name collision — so a bad request fails before
// any byte is stored; and if a later upload fails, the whole drop is removed
// rather than left half-published.
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

	detail, err := s.CreateDrop(ctx, DropInput{
		Parent:     in.Parent,
		Name:       in.Name,
		Title:      in.Title,
		Visibility: in.Visibility,
		Entrypoint: in.Entrypoint,
	})
	if err != nil {
		return DropDetail{}, err
	}

	for _, f := range normalized {
		if err := s.storeUploadedFile(ctx, detail.Path, f); err != nil {
			// Undo the whole drop: a partially uploaded bundle is worse than
			// none, because its entrypoint may reference files that never landed.
			if delErr := s.Delete(ctx, detail.Path); delErr != nil {
				return DropDetail{}, fmt.Errorf("%w (rollback also failed: %v)", err, delErr)
			}
			return DropDetail{}, err
		}
	}

	return s.GetDrop(ctx, detail.Path)
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

func (s *Service) storeUploadedFile(ctx context.Context, dropPath string, f UploadFile) error {
	body, err := f.Open()
	if err != nil {
		return err
	}
	defer body.Close()
	_, err = s.SaveFile(ctx, dropPath, f.Path, body, f.Size, f.ContentType)
	return err
}

// CreateDrop creates a drop: a node carrying metadata, plus its ".drop"
// descriptor in object storage.
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
		Entrypoint: in.Entrypoint,
		Visibility: in.Visibility,
	}
	if parentNode != nil {
		node.ParentID = &parentNode.ID
	}
	if err := s.db.WithContext(ctx).Create(&node).Error; err != nil {
		return DropDetail{}, err
	}

	if err := s.writeMeta(ctx, &node); err != nil {
		// Roll back the row so a storage outage cannot leave a drop whose
		// descriptor was never written.
		s.db.WithContext(ctx).Delete(&node)
		return DropDetail{}, err
	}

	return s.detail(ctx, &node)
}

// UpdateDropMeta patches a drop's metadata and refreshes its descriptor.
func (s *Service) UpdateDropMeta(ctx context.Context, path string, patch DropPatch) (DropDetail, error) {
	path, err := cleanPath(path)
	if err != nil {
		return DropDetail{}, err
	}
	if path == "" {
		return DropDetail{}, ErrNotDrop
	}
	node, err := s.nodeByPath(ctx, path)
	if err != nil {
		return DropDetail{}, err
	}
	if node.Kind != model.KindDrop {
		return DropDetail{}, ErrNotDrop
	}

	if patch.Title != nil {
		node.Title = *patch.Title
	}
	if patch.Entrypoint != nil {
		node.Entrypoint = *patch.Entrypoint
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
	if err := s.writeMeta(ctx, node); err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node)
}

// Delete removes a folder or drop and everything beneath it, including the
// stored objects of every drop in the subtree.
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

// SaveFile stores an uploaded file inside a drop, replacing any file of the
// same name.
func (s *Service) SaveFile(ctx context.Context, dropPath, filename string, r io.Reader, size int64, contentType string) (FileInfo, error) {
	filename, err := validFilePath(filename)
	if err != nil {
		return FileInfo{}, err
	}
	dropPath, err = cleanPath(dropPath)
	if err != nil {
		return FileInfo{}, err
	}
	node, err := s.nodeByPath(ctx, dropPath)
	if err != nil {
		return FileInfo{}, err
	}
	if node.Kind != model.KindDrop {
		return FileInfo{}, ErrNotDrop
	}

	key := objectKey(node.Slug, filename)
	if err := s.objects.Put(ctx, key, r, size, contentType); err != nil {
		return FileInfo{}, err
	}

	var file model.File
	err = s.db.WithContext(ctx).Where("node_id = ? AND name = ?", node.ID, filename).First(&file).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		file = model.File{
			NodeID:      node.ID,
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

	if err := s.touch(ctx, node); err != nil {
		return FileInfo{}, err
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
	if node, ok, err := s.descriptorTarget(ctx, path); err != nil {
		return nil, FileInfo{}, err
	} else if ok {
		info, err := s.metaFileInfo(node)
		if err != nil {
			return nil, FileInfo{}, err
		}
		body, err := s.objects.Get(ctx, objectKey(node.Slug, MetaFileName))
		if err != nil {
			return nil, FileInfo{}, err
		}
		return body, info, nil
	}

	file, _, err := s.lookupFile(ctx, path)
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

// DeleteFile removes one file from a drop.
func (s *Service) DeleteFile(ctx context.Context, path string) error {
	file, node, err := s.lookupFile(ctx, path)
	if err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Delete(file).Error; err != nil {
		return err
	}
	if err := s.objects.Delete(ctx, file.ObjectKey); err != nil {
		return err
	}
	return s.touch(ctx, node)
}

// resolveFileLocation splits a full path into the drop that owns it and the
// path of the file within that drop. Because files may sit in subdirectories,
// the split point is not simply the last "/": it is the longest prefix that is
// an actual drop node. Drops cannot nest, so at most one prefix can match.
func (s *Service) resolveFileLocation(ctx context.Context, full string) (*model.Node, string, error) {
	cleaned, err := cleanPath(full)
	if err != nil {
		return nil, "", err
	}
	segments := strings.Split(cleaned, "/")
	if len(segments) < 2 {
		return nil, "", ErrNotFound
	}

	for i := len(segments) - 1; i >= 1; i-- {
		node, err := s.nodeByPath(ctx, strings.Join(segments[:i], "/"))
		if errors.Is(err, ErrNotFound) {
			continue // an intermediate directory inside the drop, not a node
		}
		if err != nil {
			return nil, "", err
		}
		if node.Kind != model.KindDrop {
			return nil, "", ErrNotDrop
		}
		return node, strings.Join(segments[i:], "/"), nil
	}
	return nil, "", ErrNotFound
}

// descriptorTarget reports whether path addresses a drop's ".drop" descriptor,
// returning the drop it belongs to.
func (s *Service) descriptorTarget(ctx context.Context, path string) (*model.Node, bool, error) {
	node, rel, err := s.resolveFileLocation(ctx, path)
	if err != nil {
		return nil, false, err
	}
	if rel != MetaFileName {
		return nil, false, nil
	}
	return node, true, nil
}

func (s *Service) lookupFile(ctx context.Context, path string) (*model.File, *model.Node, error) {
	node, filename, err := s.resolveFileLocation(ctx, path)
	if err != nil {
		return nil, nil, err
	}
	if filename == MetaFileName {
		return nil, nil, ErrNotFound
	}

	var file model.File
	err = s.db.WithContext(ctx).Where("node_id = ? AND name = ?", node.ID, filename).First(&file).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return &file, node, nil
}

// ---------- ".drop" descriptor ----------

// writeMeta materializes the drop's metadata next to its files, so a bundle
// pulled straight out of storage still describes itself.
func (s *Service) writeMeta(ctx context.Context, node *model.Node) error {
	payload, err := yaml.Marshal(metaOf(node))
	if err != nil {
		return err
	}
	return s.objects.Put(ctx, objectKey(node.Slug, MetaFileName),
		bytes.NewReader(payload), int64(len(payload)), "application/yaml")
}

// touch bumps the drop's UpdatedAt and refreshes its descriptor.
func (s *Service) touch(ctx context.Context, node *model.Node) error {
	if err := s.db.WithContext(ctx).Model(node).Update("updated_at", time.Now().UTC()).Error; err != nil {
		return err
	}
	return s.writeMeta(ctx, node)
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
