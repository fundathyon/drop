// Package adminui renders the admin interface from templates compiled into the
// binary, so a single process serves the admin, the JSON API and the published
// drops with no separate frontend build.
package adminui

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"net/url"
	"strconv"
	"strings"
	"time"

	"drop/internal/auth"
	"drop/internal/service"
)

//go:embed templates static
var files embed.FS

// Static exposes the stylesheet and script for the HTTP layer to serve.
func Static() (fs.FS, error) { return fs.Sub(files, "static") }

// pages are the template files that each supply a "content" and an "actions"
// block. Every one is parsed together with the layout into its own set, because
// a single set cannot hold two definitions of the same block name.
var pages = []string{"explorer", "drop", "editor", "shared", "login", "invite", "users", "setup"}

// Renderer holds the parsed templates.
type Renderer struct {
	sets map[string]*template.Template
}

// New parses the embedded templates. It fails at startup rather than on the
// first request, so a broken template never reaches a user.
func New() (*Renderer, error) {
	version, err := assetVersion()
	if err != nil {
		return nil, err
	}
	fm := funcs(version)

	sets := make(map[string]*template.Template, len(pages))
	for _, page := range pages {
		t, err := template.New("layout.html").Funcs(fm).ParseFS(files,
			"templates/layout.html", "templates/"+page+".html")
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", page, err)
		}
		sets[page] = t
	}
	return &Renderer{sets: sets}, nil
}

// assetVersion digests the static files so their URLs change whenever they do.
// Without it the browser keeps a stale stylesheet across a rebuild, which reads
// as a broken layout rather than as a cache to clear.
func assetVersion() (string, error) {
	h := sha256.New()
	err := fs.WalkDir(files, "static", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		body, err := files.ReadFile(p)
		if err != nil {
			return err
		}
		h.Write([]byte(p))
		h.Write(body)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("digest static assets: %w", err)
	}
	return hex.EncodeToString(h.Sum(nil))[:12], nil
}

// Render writes a page. It buffers first: a template that fails halfway would
// otherwise leave a half-written page behind an already-sent 200.
func (r *Renderer) Render(w io.Writer, page string, data any) error {
	t, ok := r.sets[page]
	if !ok {
		return fmt.Errorf("unknown page %q", page)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return fmt.Errorf("render %s: %w", page, err)
	}
	_, err := buf.WriteTo(w)
	return err
}

// Flash is the one-shot message shown after a redirect.
type Flash struct {
	// Kind is "ok" or "error"; it selects the styling and the icon.
	Kind string
	Text string
}

// Crumb is one step of the breadcrumb. It carries the drive as well as the
// path, because a link back up a shared folder has to stay in its owner's
// tree rather than jumping to the reader's own.
type Crumb struct {
	Name  string
	Path  string
	Owner uint
}

// Base is what every page needs: the shell's title, where we are, and any
// pending flash.
type Base struct {
	Title string
	Path  string
	// Owner is whose drive the page is showing; zero is the viewer's own.
	Owner  uint
	Crumbs []Crumb
	Flash  *Flash
	// User is who is signed in. Nil on the pages reached without a session —
	// the login form and the invitation link — which is what tells the layout
	// to leave out the navigation.
	User *auth.UserInfo
	// Shared marks the "shared with me" section, so the drive tabs can say
	// which one you are in.
	Shared bool
}

// LoginPage is the sign-in form.
type LoginPage struct {
	Base
	Email string
	// Next is where to go once signed in, already checked to be a local path.
	Next  string
	Error string
}

// SetupPage is the first-run wizard: it exists exactly once per instance,
// before there is an administrator to sign in as.
type SetupPage struct {
	Base
	OrgName string
	Name    string
	Email   string
	// MinLength is surfaced so the form states the rule the server enforces.
	MinLength int
	Error     string
}

// InvitePage is where an invited person sets their password.
type InvitePage struct {
	Base
	Token string
	Email string
	Role  string
	Name  string
	// MinLength is surfaced so the form states the rule the server enforces.
	MinLength int
	// Acceptable is false for a link that is expired, revoked or already used,
	// which is the difference between showing the form and showing why not.
	Acceptable bool
	Error      string
}

// UsersPage lists accounts and invitations.
type UsersPage struct {
	Base
	Users       []auth.UserInfo
	Invitations []auth.InvitationInfo
	// Me is the signed-in administrator, so the page can refuse to offer them
	// the actions the service would reject anyway.
	Me auth.UserInfo
	// NewLink is an invitation link to show once, right after creating it.
	NewLink string
}

// ExplorerPage lists the folders and drops under a path.
type ExplorerPage struct {
	Base
	Nodes []service.Node
	// Mode is "grid" or "list".
	Mode string
}

// DropPage shows a drop's files and its publication history.
type DropPage struct {
	Base
	Detail service.DropDetail
	// Shares is who else has access. Empty for someone who could not grant it
	// anyway, who has no business seeing the list.
	Shares []service.ShareInfo
	// People are the accounts the drop can be shared with, for the picker.
	People []auth.UserInfo
}

// SharedPage lists what other people granted the viewer.
type SharedPage struct {
	Base
	Nodes []service.SharedNode
}

// EditorPage shows one stored file: its text when we can edit it, a preview
// when it is an image, and a download link otherwise.
type EditorPage struct {
	Base
	// DropPath is the drop the file belongs to, which is where saving posts to,
	// and DropOwner is whose drive that is.
	DropPath  string
	DropOwner uint
	Name      string
	File      service.FileInfo
	Type      FileType
	Content   string
	// RawURL downloads the file as stored.
	RawURL string
	// ReadOnly hides the save controls for someone who may look but not write.
	ReadOnly bool
}

// Breadcrumbs splits a reference into its navigable steps. The root is added
// by the template, so an empty path yields no crumbs.
//
// Every step keeps the drive it belongs to: walking up out of a shared folder
// would otherwise land on the viewer's own tree at the same path, which is a
// different place entirely.
func Breadcrumbs(ref service.Ref) []Crumb {
	if ref.Path == "" {
		return nil
	}
	parts := strings.Split(ref.Path, "/")
	crumbs := make([]Crumb, 0, len(parts))
	for i, part := range parts {
		crumbs = append(crumbs, Crumb{
			Name:  part,
			Path:  strings.Join(parts[:i+1], "/"),
			Owner: ref.Owner,
		})
	}
	return crumbs
}

// URLFor builds a link to a path inside a drive.
//
// It returns template.URL rather than a string because the result is a whole
// URL, not a value inside one: escaped as an ordinary attribute the "&" and
// "=" would arrive as literal text and every parameter after the first would
// be swallowed. The query is assembled here with url.Values, so what is being
// vouched for is something this function built.
func URLFor(base string, owner uint, path string) template.URL {
	return template.URL(base + "?" + driveQuery(owner, path).Encode())
}

// EditURL points at the editor, which needs the file name apart from the drop
// because a name may itself contain slashes.
func EditURL(owner uint, dropPath, name string) template.URL {
	q := driveQuery(owner, dropPath)
	q.Set("name", name)
	return template.URL("/admin/edit?" + q.Encode())
}

func driveQuery(owner uint, path string) url.Values {
	q := url.Values{}
	if owner != 0 {
		q.Set("owner", strconv.FormatUint(uint64(owner), 10))
	}
	q.Set("path", path)
	return q
}

// ParentOf is the containing folder of a path, "" for a top-level node.
func ParentOf(path string) string {
	i := strings.LastIndex(path, "/")
	if i == -1 {
		return ""
	}
	return path[:i]
}

// JoinPath appends a name to a folder path.
func JoinPath(parent, name string) string {
	if parent == "" {
		return name
	}
	return parent + "/" + name
}

// StaticPrefix is where the HTTP layer must mount Static().
const StaticPrefix = "/admin/static/"

func funcs(version string) template.FuncMap {
	return template.FuncMap{
		"icon":       icon,
		"fileType":   TypeOf,
		"formatSize": formatSize,
		"formatDate": formatDate,
		"joinPath":   JoinPath,
		"parentOf":   ParentOf,
		"asset":      func(name string) string { return StaticPrefix + name + "?v=" + version },
		"dict":       dict,
		"urlFor":     URLFor,
		"editURL":    EditURL,
	}
}

// dict builds a map from alternating key/value arguments, so a shared template
// can be invoked with more than the single argument {{template}} allows.
func dict(pairs ...any) (map[string]any, error) {
	if len(pairs)%2 != 0 {
		return nil, fmt.Errorf("dict: odd number of arguments (%d)", len(pairs))
	}
	m := make(map[string]any, len(pairs)/2)
	for i := 0; i < len(pairs); i += 2 {
		key, ok := pairs[i].(string)
		if !ok {
			return nil, fmt.Errorf("dict: key %d is not a string", i)
		}
		m[key] = pairs[i+1]
	}
	return m, nil
}

// formatSize mirrors the units the admin has always shown: bytes below a
// kilobyte, one decimal above.
func formatSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	units := []string{"KB", "MB", "GB"}
	value := float64(bytes) / 1024
	i := 0
	for value >= 1024 && i < len(units)-1 {
		value /= 1024
		i++
	}
	return fmt.Sprintf("%.1f %s", value, units[i])
}

// formatDate renders a timestamp for reading. The browser used to localise
// this; rendering on the server means one fixed format, in the server's zone.
//
// It takes *time.Time as well, because "never signed in" is a nil pointer on
// the users page and a template cannot dereference one safely.
func formatDate(value any) string {
	var t time.Time
	switch v := value.(type) {
	case time.Time:
		t = v
	case *time.Time:
		if v == nil {
			return "—"
		}
		t = *v
	default:
		return "—"
	}
	if t.IsZero() {
		return "—"
	}
	return t.Local().Format("2006-01-02 15:04")
}
