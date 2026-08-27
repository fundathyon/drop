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

	"drop/internal/db"
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

// AdoptOwnerlessNodes hands the pre-ownership tree to ownerID. main.go runs
// the same migration for the headless bootstrap path; this exists so the
// interactive setup wizard — which only reaches this Service, not the raw
// database handle main.go has — can run it too, right after creating the
// first administrator. Takes a context for a uniform call shape with the rest
// of this type, even though the migration underneath does not use one.
func (s *Service) AdoptOwnerlessNodes(_ context.Context, ownerID uint) (int64, error) {
	return db.AdoptOwnerlessNodes(s.db, ownerID)
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
	// Owner is whose drive it lives in. A path only identifies a node together
	// with this, since every user has their own tree.
	Owner uint `json:"owner" example:"1"`
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
	// visibility: a private drop answers there only for the accounts that may
	// open it, and 404s for everyone else.
	URL   string     `json:"url" example:"http://localhost:8000/d/An1UHNyp/"`
	Meta  DropMeta   `json:"meta"`
	Files []FileInfo `json:"files"`
	// Versions is the publication history, newest first.
	Versions []VersionInfo `json:"versions"`
	// EntrypointMissing marks a drop whose entrypoint names no file it holds.
	// Its URL answers 404 until a page by that name arrives, or the metadata
	// is pointed at one that exists.
	EntrypointMissing bool `json:"entrypoint_missing" example:"false"`
	// Access is what the caller may do with it: owner, editor or viewer. The
	// interface hides the actions it does not cover.
	Access Access `json:"access" enums:"owner,editor,viewer" example:"owner"`
}

// DropInput carries the fields accepted when creating a drop.
type DropInput struct {
	// ParentRef addresses the destination folder; its Owner picks the drive.
	ParentRef  Ref
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

// ---------- addressing and access ----------

// Ref addresses a path inside one user's drive. A path alone stopped being an
// address the moment every user got their own tree: two people may each have a
// "Proyectos", and they are different folders.
type Ref struct {
	// Owner is whose drive the path belongs to. Zero means the caller's own,
	// which is what nearly every request means.
	Owner uint
	Path  string
}

// Own addresses a path in the caller's own drive.
func Own(path string) Ref { return Ref{Path: path} }

// In addresses a path in someone else's drive, reached through a share.
func In(owner uint, path string) Ref { return Ref{Owner: owner, Path: path} }

// drive resolves which tree a reference is about.
func (r Ref) drive(actor uint) uint {
	if r.Owner == 0 {
		return actor
	}
	return r.Owner
}

// Access is the effective level an actor has on a node: what they own, what
// was shared with them, or nothing.
type Access string

const (
	AccessNone   Access = ""
	AccessViewer Access = Access(model.AccessViewer)
	AccessEditor Access = Access(model.AccessEditor)
	AccessOwner  Access = "owner"
)

// CanRead reports whether the node may be listed, opened and downloaded.
func (a Access) CanRead() bool { return a != AccessNone }

// CanWrite reports whether its contents may be changed.
func (a Access) CanWrite() bool { return a == AccessEditor || a == AccessOwner }

// CanShare reports whether access may be handed to someone else. Editors may,
// so a team does not have to route every request through one person.
func (a Access) CanShare() bool { return a == AccessEditor || a == AccessOwner }

// ErrForbidden means the caller can see that something exists but may not do
// this to it. Not being able to see it at all is ErrNotFound: telling someone
// which paths exist in a drive they have no access to is itself a leak.
var ErrForbidden = errors.New("not allowed")

// accessTo resolves what an actor may do with a node.
//
// Shares are stored on the node they were granted on and apply to everything
// beneath it, so a grant is found by looking at the node itself and at every
// ancestor — which, with materialized paths, is a prefix test.
func (s *Service) accessTo(ctx context.Context, actor uint, node *model.Node) (Access, error) {
	if node.OwnerID == actor {
		return AccessOwner, nil
	}

	type grant struct {
		Path   string
		Access string
	}
	var grants []grant
	err := s.db.WithContext(ctx).
		Table("shares").
		Select("nodes.path AS path, shares.access AS access").
		Joins("JOIN nodes ON nodes.id = shares.node_id").
		Where("shares.user_id = ? AND nodes.owner_id = ?", actor, node.OwnerID).
		Scan(&grants).Error
	if err != nil {
		return AccessNone, err
	}

	best := AccessNone
	for _, g := range grants {
		if node.Path != g.Path && !strings.HasPrefix(node.Path, g.Path+"/") {
			continue
		}
		if Access(g.Access) == AccessEditor {
			return AccessEditor, nil // nothing beats it short of ownership
		}
		best = AccessViewer
	}
	return best, nil
}

// readable resolves a reference and checks the caller may look at it.
func (s *Service) readable(ctx context.Context, actor uint, ref Ref) (*model.Node, Access, error) {
	node, err := s.resolve(ctx, actor, ref)
	if err != nil {
		return nil, AccessNone, err
	}
	level, err := s.accessTo(ctx, actor, node)
	if err != nil {
		return nil, AccessNone, err
	}
	if !level.CanRead() {
		// Deliberately indistinguishable from a path that does not exist.
		return nil, AccessNone, ErrNotFound
	}
	return node, level, nil
}

// writable is readable plus the right to change what is inside.
func (s *Service) writable(ctx context.Context, actor uint, ref Ref) (*model.Node, Access, error) {
	node, level, err := s.readable(ctx, actor, ref)
	if err != nil {
		return nil, AccessNone, err
	}
	if !level.CanWrite() {
		return nil, level, ErrForbidden
	}
	return node, level, nil
}

// resolve turns a reference into the row it names, without judging access.
func (s *Service) resolve(ctx context.Context, actor uint, ref Ref) (*model.Node, error) {
	path, err := cleanPath(ref.Path)
	if err != nil {
		return nil, err
	}
	if path == "" {
		// The root of a drive is not a node: there is nothing to own, rename or
		// delete, so naming it here is a bad address rather than a miss.
		return nil, ErrInvalidPath
	}
	return s.nodeByPath(ctx, ref.drive(actor), path)
}

// ---------- reads ----------

func (s *Service) nodeByPath(ctx context.Context, owner uint, path string) (*model.Node, error) {
	var n model.Node
	err := s.db.WithContext(ctx).
		Where("owner_id = ? AND path = ?", owner, path).First(&n).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// List returns the folders and drops directly under a reference. An empty path
// is the root of a drive, which only its owner may list: someone who was given
// one folder has no business enumerating the rest.
//
// The level returned is the caller's access to the listed folder itself, not to
// its children — every child inherits it anyway. It is what tells the admin
// whether this folder may be added to or shared, which a listing of names alone
// cannot say.
func (s *Service) List(ctx context.Context, actor uint, ref Ref) ([]Node, Access, error) {
	path, err := cleanPath(ref.Path)
	if err != nil {
		return nil, AccessNone, err
	}
	drive := ref.drive(actor)

	// A drive's root is not a node, so there is no grant to look up: reaching
	// it at all already means it is the caller's own.
	level := AccessOwner

	query := s.db.WithContext(ctx).Model(&model.Node{}).Where("owner_id = ?", drive)
	if path == "" {
		if drive != actor {
			return nil, AccessNone, ErrNotFound
		}
		query = query.Where("parent_id IS NULL")
	} else {
		parent, parentLevel, err := s.readable(ctx, actor, ref)
		if err != nil {
			return nil, AccessNone, err
		}
		if parent.Kind == model.KindDrop {
			return nil, AccessNone, ErrIsDrop
		}
		level = parentLevel
		query = query.Where("parent_id = ?", parent.ID)
	}

	var rows []model.Node
	if err := query.Order("name").Find(&rows).Error; err != nil {
		return nil, AccessNone, err
	}

	nodes := make([]Node, 0, len(rows))
	for _, r := range rows {
		nodes = append(nodes, Node{Name: r.Name, Path: r.Path, Kind: r.Kind, Owner: r.OwnerID})
	}
	return nodes, level, nil
}

// GetDrop returns a drop's metadata, the files of its current version, and its
// publication history.
func (s *Service) GetDrop(ctx context.Context, actor uint, ref Ref) (DropDetail, error) {
	node, level, err := s.dropByRef(ctx, actor, ref)
	if err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node, level)
}

// dropByRef resolves a reference that has to be a drop, and the caller's access
// to it.
func (s *Service) dropByRef(ctx context.Context, actor uint, ref Ref) (*model.Node, Access, error) {
	path, err := cleanPath(ref.Path)
	if err != nil {
		return nil, AccessNone, err
	}
	if path == "" {
		return nil, AccessNone, ErrNotDrop
	}
	node, level, err := s.readable(ctx, actor, ref)
	if err != nil {
		return nil, AccessNone, err
	}
	if node.Kind != model.KindDrop {
		return nil, AccessNone, ErrNotDrop
	}
	return node, level, nil
}

func (s *Service) dropByPath(ctx context.Context, owner uint, path string) (*model.Node, error) {
	path, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, ErrNotDrop
	}
	node, err := s.nodeByPath(ctx, owner, path)
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
func (s *Service) ListVersions(ctx context.Context, actor uint, ref Ref) ([]VersionInfo, error) {
	node, _, err := s.dropByRef(ctx, actor, ref)
	if err != nil {
		return nil, err
	}
	return s.history(ctx, node)
}

func (s *Service) detail(ctx context.Context, node *model.Node, level Access) (DropDetail, error) {
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

	// A drop whose entrypoint names nothing it holds answers 404 at its own
	// URL. Reporting it is what stops the admin from offering a link that
	// cannot work, which reads as the server being broken.
	entrypointMissing := true
	for _, f := range files {
		if f.Name == version.Entrypoint {
			entrypointMissing = false
			break
		}
	}

	return DropDetail{
		Node:              Node{Name: node.Name, Path: node.Path, Kind: node.Kind, Owner: node.OwnerID},
		URL:               s.publicURL(node.Slug),
		Meta:              metaOf(node, version),
		Files:             infos,
		Versions:          versions,
		EntrypointMissing: entrypointMissing,
		Access:            level,
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

// ownerOrEditor names the access a caller must have had to create something
// in a drive: their own makes them the owner, anyone else's means a share let
// them write there.
func ownerOrEditor(actor, owner uint) Access {
	if actor == owner {
		return AccessOwner
	}
	return AccessEditor
}

// isSharedRoot reports whether a node is one the actor was granted directly,
// rather than something inside one.
func (s *Service) isSharedRoot(ctx context.Context, actor uint, node *model.Node) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&model.Share{}).
		Where("node_id = ? AND user_id = ?", node.ID, actor).Count(&count).Error
	return count > 0, err
}

// ---------- writes ----------

// resolveParent returns the parent node for a create operation, and the drive
// the new node will belong to. A nil node means the root of that drive.
//
// Creating at the root of somebody else's drive is refused: a share is a way
// into one folder, not a licence to add things next to it.
func (s *Service) resolveParent(ctx context.Context, actor uint, ref Ref) (*model.Node, string, uint, error) {
	parent, err := cleanPath(ref.Path)
	if err != nil {
		return nil, "", 0, err
	}
	drive := ref.drive(actor)
	if parent == "" {
		if drive != actor {
			return nil, "", 0, ErrNotFound
		}
		return nil, "", actor, nil
	}
	node, _, err := s.writable(ctx, actor, ref)
	if err != nil {
		return nil, "", 0, err
	}
	if node.Kind == model.KindDrop {
		return nil, "", 0, ErrIsDrop
	}
	return node, node.Path, node.OwnerID, nil
}

func (s *Service) exists(ctx context.Context, owner uint, path string) (bool, error) {
	var count int64
	if err := s.db.WithContext(ctx).Model(&model.Node{}).
		Where("owner_id = ? AND path = ?", owner, path).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// CreateFolder creates a plain organizational folder.
func (s *Service) CreateFolder(ctx context.Context, actor uint, parent Ref, name string) (Node, error) {
	if err := validName(name); err != nil {
		return Node{}, err
	}
	parentNode, parentPath, owner, err := s.resolveParent(ctx, actor, parent)
	if err != nil {
		return Node{}, err
	}

	path := joinPath(parentPath, name)
	taken, err := s.exists(ctx, owner, path)
	if err != nil {
		return Node{}, err
	}
	if taken {
		return Node{}, ErrExists
	}

	node := model.Node{OwnerID: owner, Name: name, Path: path, Kind: model.KindFolder}
	if parentNode != nil {
		node.ParentID = &parentNode.ID
	}
	if err := s.db.WithContext(ctx).Create(&node).Error; err != nil {
		return Node{}, err
	}
	return Node{Name: node.Name, Path: node.Path, Kind: node.Kind, Owner: node.OwnerID}, nil
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
	// Parent addresses the destination folder. Its Owner decides which drive
	// the drop lands in; zero means the caller's own.
	ParentRef  Ref
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
func (s *Service) UploadDrop(ctx context.Context, actor uint, in UploadDropInput) (DropDetail, error) {
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

	parentRef := in.ParentRef
	if parentRef.Path == "" {
		parentRef.Path = in.Parent
	}
	parentNode, parentPath, owner, err := s.resolveParent(ctx, actor, parentRef)
	if err != nil {
		return DropDetail{}, err
	}
	path := joinPath(parentPath, in.Name)

	// A drop already at this path is republished rather than rejected; a plain
	// folder there is a genuine collision.
	node, err := s.nodeByPath(ctx, owner, path)
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
			OwnerID:    owner,
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
		// Republishing rewrites what the drop serves, so it is a write even
		// though the row already exists.
		if level, err := s.accessTo(ctx, actor, node); err != nil {
			return DropDetail{}, err
		} else if !level.CanWrite() {
			return DropDetail{}, ErrForbidden
		}
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
				if delErr := s.deleteNode(ctx, node); delErr != nil {
					return DropDetail{}, fmt.Errorf("%w (rollback also failed: %v)", err, delErr)
				}
			}
			return DropDetail{}, err
		}
	}

	if err := s.publishVersion(ctx, node, version); err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node, ownerOrEditor(actor, node.OwnerID))
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
func (s *Service) ActivateVersion(ctx context.Context, actor uint, ref Ref, seq uint) (DropDetail, error) {
	node, level, err := s.dropByRef(ctx, actor, ref)
	if err != nil {
		return DropDetail{}, err
	}
	if !level.CanWrite() {
		return DropDetail{}, ErrForbidden
	}
	version, err := s.versionBySeq(ctx, node.ID, seq)
	if err != nil {
		return DropDetail{}, err
	}
	if err := s.publishVersion(ctx, node, version); err != nil {
		return DropDetail{}, err
	}
	return s.detail(ctx, node, level)
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
func (s *Service) CreateDrop(ctx context.Context, actor uint, in DropInput) (DropDetail, error) {
	if err := validName(in.Name); err != nil {
		return DropDetail{}, err
	}
	parentRef := in.ParentRef
	if parentRef.Path == "" {
		parentRef.Path = in.Parent
	}
	parentNode, parentPath, owner, err := s.resolveParent(ctx, actor, parentRef)
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
	taken, err := s.exists(ctx, owner, path)
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
		OwnerID:    owner,
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

	return s.detail(ctx, &node, ownerOrEditor(actor, owner))
}

// UpdateDropMeta patches a drop's metadata and refreshes its descriptor. Only
// the current version is affected; sealed ones keep the entrypoint they were
// published with.
func (s *Service) UpdateDropMeta(ctx context.Context, actor uint, ref Ref, patch DropPatch) (DropDetail, error) {
	node, level, err := s.dropByRef(ctx, actor, ref)
	if err != nil {
		return DropDetail{}, err
	}
	if !level.CanWrite() {
		return DropDetail{}, ErrForbidden
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
	return s.detail(ctx, node, level)
}

// Delete removes a folder or drop and everything beneath it, including every
// version of every drop in the subtree.
func (s *Service) Delete(ctx context.Context, actor uint, ref Ref) error {
	node, level, err := s.readable(ctx, actor, ref)
	if err != nil {
		return err
	}
	if !level.CanWrite() {
		return ErrForbidden
	}
	// An editor works inside what was shared; removing the shared thing itself
	// is the one act they could not undo and the owner did not ask for.
	if level != AccessOwner {
		shared, err := s.isSharedRoot(ctx, actor, node)
		if err != nil {
			return err
		}
		if shared {
			return ErrForbidden
		}
	}
	return s.deleteNode(ctx, node)
}

// deleteNode does the removal itself, once the caller is known to be allowed.
func (s *Service) deleteNode(ctx context.Context, node *model.Node) error {
	var subtree []model.Node
	if err := s.db.WithContext(ctx).
		Where("owner_id = ? AND (path = ? OR path LIKE ?)", node.OwnerID, node.Path, node.Path+"/%").
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
		// Grants on anything that is going away go with it, or they would
		// keep a removed folder listed in someone's shared section.
		if err := tx.Where("node_id IN ?", ids).Delete(&model.Share{}).Error; err != nil {
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
func (s *Service) SaveFile(ctx context.Context, actor uint, ref Ref, filename string, r io.Reader, size int64, contentType string) (FileInfo, error) {
	node, level, err := s.dropByRef(ctx, actor, ref)
	if err != nil {
		return FileInfo{}, err
	}
	if !level.CanWrite() {
		return FileInfo{}, ErrForbidden
	}
	version, err := s.currentVersion(ctx, node)
	if err != nil {
		return FileInfo{}, err
	}

	info, err := s.saveFile(ctx, node, version, filename, r, size, contentType)
	if err != nil {
		return FileInfo{}, err
	}
	if err := s.adoptEntrypoint(ctx, version); err != nil {
		return FileInfo{}, err
	}
	if err := s.touch(ctx, node, version); err != nil {
		return FileInfo{}, err
	}
	return info, nil
}

// adoptEntrypoint repairs a drop that points at a page it does not have.
//
// A drop created before its files exist gets the default "index.html", and
// uploading a page under any other name used to leave that pointing at
// nothing: the drop looked fine in the admin and answered 404 at its own URL.
// Once the files can name a page unambiguously, the drop follows them.
//
// It only ever fills a gap. An entrypoint that resolves is a deliberate choice
// and is left alone, and an ambiguous set of pages leaves the drop as it was
// rather than picking for the user — this is a repair, not a reason to fail an
// upload that otherwise worked.
func (s *Service) adoptEntrypoint(ctx context.Context, version *model.Version) error {
	files, err := s.filesOf(ctx, version.ID)
	if err != nil {
		return err
	}

	names := make([]string, 0, len(files))
	for _, f := range files {
		if f.Name == MetaFileName {
			continue // generated; never the page to open
		}
		if f.Name == version.Entrypoint {
			return nil
		}
		names = append(names, f.Name)
	}

	entrypoint, err := inferEntrypoint(names)
	if err != nil {
		return nil
	}
	if err := s.db.WithContext(ctx).Model(version).
		Update("entrypoint", entrypoint).Error; err != nil {
		return err
	}
	version.Entrypoint = entrypoint
	return nil
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
func (s *Service) OpenFile(ctx context.Context, actor uint, ref Ref) (io.ReadCloser, FileInfo, error) {
	node, version, rel, err := s.resolveFileLocation(ctx, actor, ref)
	if err != nil {
		return nil, FileInfo{}, err
	}
	level, err := s.accessTo(ctx, actor, node)
	if err != nil {
		return nil, FileInfo{}, err
	}
	if !level.CanRead() {
		return nil, FileInfo{}, ErrNotFound
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
// hides a drop the actor may not open behind ErrNotFound.
func (s *Service) GetDropBySlug(ctx context.Context, actor uint, slug string) (DropDetail, error) {
	node, err := s.publishedDrop(ctx, actor, slug)
	if err != nil {
		return DropDetail{}, err
	}
	// A published page is not the panel: it offers none of the actions an
	// access level would unlock, so it carries none.
	return s.detail(ctx, node, AccessNone)
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
func (s *Service) GetPublishedVersion(ctx context.Context, actor uint, slug string, seq uint, pinned bool) (PublishedVersion, error) {
	node, err := s.publishedDrop(ctx, actor, slug)
	if err != nil {
		return PublishedVersion{}, err
	}
	detail, err := s.detail(ctx, node, AccessNone)
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

// publishedDrop resolves a slug to a drop that may be served to this actor.
//
// A private drop is not published, but it is not a dead address either: whoever
// can open it in the panel — its owner, and anyone it has been shared with —
// can open its URL too. To everybody else, signed in or not, it answers
// ErrNotFound rather than a 403, so the response never confirms that the slug
// exists. An actor of zero is an anonymous visitor.
func (s *Service) publishedDrop(ctx context.Context, actor uint, slug string) (*model.Node, error) {
	var node model.Node
	err := s.db.WithContext(ctx).
		Where("slug = ? AND kind = ?", slug, model.KindDrop).First(&node).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if node.Visibility != model.VisibilityPrivate {
		return &node, nil
	}
	if actor == 0 {
		return nil, ErrNotFound
	}
	level, err := s.accessTo(ctx, actor, &node)
	if err != nil {
		return nil, err
	}
	if !level.CanRead() {
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

// PublicFile is a file being served from a drop's own URL.
type PublicFile struct {
	FileInfo
	// Restricted marks a file that answers only to certain accounts, because
	// the drop it belongs to is private. Whoever serves it has to keep it out
	// of any cache that could later hand it to somebody else.
	Restricted bool
}

// OpenPublicFile serves a drop by slug. An empty relPath resolves to the
// version's entrypoint; a leading "@<seq>" pins an older snapshot. An actor of
// zero is an anonymous visitor, who only ever reaches a non-private drop.
func (s *Service) OpenPublicFile(ctx context.Context, actor uint, slug, relPath string) (io.ReadCloser, PublicFile, error) {
	node, err := s.publishedDrop(ctx, actor, slug)
	if err != nil {
		return nil, PublicFile{}, err
	}

	seq, rest, pinned := SplitVersionRef(relPath)
	version, err := s.resolveVersion(ctx, node, seq, pinned)
	if err != nil {
		return nil, PublicFile{}, err
	}

	if rest == "" {
		rest = version.Entrypoint
	}
	clean, err := validFilePath(rest)
	if err != nil {
		return nil, PublicFile{}, err
	}

	var file model.File
	err = s.db.WithContext(ctx).
		Where("version_id = ? AND name = ?", version.ID, clean).First(&file).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, PublicFile{}, ErrNotFound
	}
	if err != nil {
		return nil, PublicFile{}, err
	}

	body, err := s.objects.Get(ctx, file.ObjectKey)
	if err != nil {
		return nil, PublicFile{}, err
	}
	return body, PublicFile{
		FileInfo: FileInfo{
			Name:        file.Name,
			Size:        file.Size,
			ContentType: file.ContentType,
			ModifiedAt:  file.UpdatedAt.UTC(),
		},
		Restricted: node.Visibility == model.VisibilityPrivate,
	}, nil
}

// DeleteFile removes one file from a drop's current version.
func (s *Service) DeleteFile(ctx context.Context, actor uint, ref Ref) error {
	node, version, rel, err := s.resolveFileLocation(ctx, actor, ref)
	if err != nil {
		return err
	}
	if rel == MetaFileName {
		return ErrNotFound
	}
	level, err := s.accessTo(ctx, actor, node)
	if err != nil {
		return err
	}
	if !level.CanWrite() {
		return ErrForbidden
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
func (s *Service) resolveFileLocation(ctx context.Context, actor uint, ref Ref) (*model.Node, *model.Version, string, error) {
	owner := ref.drive(actor)
	cleaned, err := cleanPath(ref.Path)
	if err != nil {
		return nil, nil, "", err
	}
	segments := strings.Split(cleaned, "/")
	if len(segments) < 2 {
		return nil, nil, "", ErrNotFound
	}

	for i := len(segments) - 1; i >= 1; i-- {
		node, err := s.nodeByPath(ctx, owner, strings.Join(segments[:i], "/"))
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
