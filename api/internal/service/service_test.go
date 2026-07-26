package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"drop/internal/db"
	"drop/internal/model"
)

// fakeStore is an in-memory ObjectStore so the service can be tested without
// a running MinIO.
type fakeStore struct {
	mu      sync.Mutex
	objects map[string][]byte
	// failOn makes Put fail for any key containing this substring, so a
	// mid-upload storage outage can be exercised.
	failOn string
}

func newFakeStore() *fakeStore {
	return &fakeStore{objects: map[string][]byte{}}
}

func (f *fakeStore) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	if f.failOn != "" && strings.Contains(key, f.failOn) {
		return errors.New("storage unavailable")
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = data
	return nil
}

func (f *fakeStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	data, ok := f.objects[key]
	if !ok {
		return nil, ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (f *fakeStore) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

func (f *fakeStore) DeletePrefix(_ context.Context, prefix string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for k := range f.objects {
		if strings.HasPrefix(k, prefix) {
			delete(f.objects, k)
		}
	}
	return nil
}

func (f *fakeStore) keys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.objects))
	for k := range f.objects {
		out = append(out, k)
	}
	return out
}

// uploaded drops the generated ".drop" descriptor, which every drop lists, so
// assertions can talk about the files a user actually put there.
func uploaded(files []FileInfo) []FileInfo {
	out := make([]FileInfo, 0, len(files))
	for _, f := range files {
		if !f.Generated {
			out = append(out, f)
		}
	}
	return out
}

func newTestService(t *testing.T) (*Service, *fakeStore) {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	store := newFakeStore()
	return New(database, store, "http://localhost:8000"), store
}

func TestCreateFolderAndDrop(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	if _, err := svc.CreateFolder(ctx, "", "proyectos"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}

	nodes, err := svc.List(ctx, "")
	if err != nil {
		t.Fatalf("List root: %v", err)
	}
	if len(nodes) != 1 || nodes[0].Kind != model.KindFolder {
		t.Fatalf("unexpected root listing: %+v", nodes)
	}

	drop, err := svc.CreateDrop(ctx, DropInput{
		Parent: "proyectos", Name: "arquitectura",
		Title: "Arquitectura", Visibility: model.VisibilityPublic,
	})
	if err != nil {
		t.Fatalf("CreateDrop: %v", err)
	}
	if drop.Meta.Slug == "" {
		t.Fatal("expected a generated slug")
	}
	if drop.Path != "proyectos/arquitectura" {
		t.Fatalf("unexpected path: %s", drop.Path)
	}
	if drop.Meta.Entrypoint != "index.html" {
		t.Fatalf("expected default entrypoint, got %q", drop.Meta.Entrypoint)
	}

	children, err := svc.List(ctx, "proyectos")
	if err != nil {
		t.Fatalf("List proyectos: %v", err)
	}
	if len(children) != 1 || children[0].Kind != model.KindDrop {
		t.Fatalf("expected one drop child, got %+v", children)
	}

	// Listing a drop is a category error: it holds files, not child nodes.
	if _, err := svc.List(ctx, "proyectos/arquitectura"); err != ErrIsDrop {
		t.Fatalf("expected ErrIsDrop, got %v", err)
	}

	// Nor can a drop hold folders.
	if _, err := svc.CreateFolder(ctx, "proyectos/arquitectura", "sub"); err != ErrIsDrop {
		t.Fatalf("expected ErrIsDrop creating inside a drop, got %v", err)
	}

	// Duplicate names collide.
	if _, err := svc.CreateFolder(ctx, "", "proyectos"); err != ErrExists {
		t.Fatalf("expected ErrExists, got %v", err)
	}
}

func TestDropDescriptorMaterialized(t *testing.T) {
	ctx := context.Background()
	svc, store := newTestService(t)

	drop, err := svc.CreateDrop(ctx, DropInput{Name: "site", Title: "Site"})
	if err != nil {
		t.Fatalf("CreateDrop: %v", err)
	}

	key := objectKey(drop.Meta.Slug, drop.Meta.Version, MetaFileName)
	body, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("expected %s to exist in storage: %v", key, err)
	}
	defer body.Close()

	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read descriptor: %v", err)
	}
	for _, want := range []string{"title: Site", "slug: " + drop.Meta.Slug, "entrypoint: index.html"} {
		if !strings.Contains(string(data), want) {
			t.Errorf("descriptor missing %q; got:\n%s", want, data)
		}
	}
}

func TestDescriptorIsListedAndReadableButNotWritable(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	if _, err := svc.CreateDrop(ctx, DropInput{Name: "site", Title: "Site"}); err != nil {
		t.Fatalf("CreateDrop: %v", err)
	}

	detail, err := svc.GetDrop(ctx, "site")
	if err != nil {
		t.Fatalf("GetDrop: %v", err)
	}
	if len(detail.Files) != 1 {
		t.Fatalf("expected the descriptor to be listed, got %+v", detail.Files)
	}
	descriptor := detail.Files[0]
	if descriptor.Name != MetaFileName || !descriptor.Generated {
		t.Fatalf("unexpected descriptor entry: %+v", descriptor)
	}
	if descriptor.Size == 0 {
		t.Error("descriptor should report the size of the stored YAML")
	}

	// Readable...
	body, info, err := svc.OpenFile(ctx, "site/"+MetaFileName)
	if err != nil {
		t.Fatalf("OpenFile descriptor: %v", err)
	}
	data, _ := io.ReadAll(body)
	body.Close()
	if !strings.Contains(string(data), "title: Site") {
		t.Errorf("descriptor content unexpected:\n%s", data)
	}
	if !info.Generated {
		t.Error("descriptor read should be flagged as generated")
	}

	// ...but never writable or deletable through the file API.
	if _, err := svc.SaveFile(ctx, "site", MetaFileName, strings.NewReader("x"), 1, "text/plain"); err != ErrInvalidPath {
		t.Errorf("expected ErrInvalidPath overwriting the descriptor, got %v", err)
	}
	if err := svc.DeleteFile(ctx, "site/"+MetaFileName); err != ErrNotFound {
		t.Errorf("expected ErrNotFound deleting the descriptor, got %v", err)
	}

	// Deleting it must not have removed it.
	if detail, err = svc.GetDrop(ctx, "site"); err != nil || len(detail.Files) != 1 {
		t.Fatalf("descriptor should survive: err=%v files=%+v", err, detail.Files)
	}
}

func uploadFile(path, contentType, body string) UploadFile {
	return UploadFile{
		Path:        path,
		ContentType: contentType,
		Size:        int64(len(body)),
		Open:        func() (io.ReadCloser, error) { return io.NopCloser(strings.NewReader(body)), nil },
	}
}

func TestUploadDrop(t *testing.T) {
	ctx := context.Background()
	svc, store := newTestService(t)

	detail, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Arquitectura del sistema",
		Files: []UploadFile{
			uploadFile("index.html", "text/html", "<h1>hola</h1>"),
			uploadFile("assets/app.css", "text/css", "body{}"),
		},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	// Name defaults to a slug of the title; visibility defaults to public.
	if detail.Name != "arquitectura-del-sistema" {
		t.Errorf("unexpected derived name: %q", detail.Name)
	}
	if detail.Meta.Visibility != model.VisibilityPublic {
		t.Errorf("expected public by default, got %q", detail.Meta.Visibility)
	}
	if detail.Meta.Entrypoint != "index.html" {
		t.Errorf("unexpected entrypoint: %q", detail.Meta.Entrypoint)
	}

	names := make([]string, 0, len(detail.Files))
	for _, f := range uploaded(detail.Files) {
		names = append(names, f.Name)
	}
	if len(names) != 2 || names[0] != "assets/app.css" || names[1] != "index.html" {
		t.Fatalf("unexpected files: %v", names)
	}

	// The nested file is readable back through its full path.
	body, _, err := svc.OpenFile(ctx, detail.Path+"/assets/app.css")
	if err != nil {
		t.Fatalf("OpenFile nested: %v", err)
	}
	got, _ := io.ReadAll(body)
	body.Close()
	if string(got) != "body{}" {
		t.Errorf("nested round-trip mismatch: %q", got)
	}

	// Stored under the drop's slug and version, preserving the subdirectory.
	wantKey := "drops/" + detail.Meta.Slug + "/v1/assets/app.css"
	if _, err := store.Get(ctx, wantKey); err != nil {
		t.Errorf("expected object at %s: %v", wantKey, err)
	}
}

func TestUploadDropInfersEntrypoint(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name  string
		files []string
		want  string
	}{
		{
			name:  "a lone page becomes the entrypoint whatever its name",
			files: []string{"requisitos-planes-facturacion.html"},
			want:  "requisitos-planes-facturacion.html",
		},
		{
			name:  "a lone page alongside assets still wins",
			files: []string{"assets/app.css", "informe.html", "assets/logo.svg"},
			want:  "informe.html",
		},
		{
			name:  "index.html wins when there are several pages",
			files: []string{"about.html", "index.html", "contact.html"},
			want:  "index.html",
		},
		{
			name:  "a nested index decides it when there is no root one",
			files: []string{"site/index.html", "site/about.html"},
			want:  "site/index.html",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := newTestService(t)
			files := make([]UploadFile, 0, len(tc.files))
			for _, p := range tc.files {
				files = append(files, uploadFile(p, "text/html", "x"))
			}
			detail, err := svc.UploadDrop(ctx, UploadDropInput{Title: "Inferido", Files: files})
			if err != nil {
				t.Fatalf("UploadDrop: %v", err)
			}
			if detail.Meta.Entrypoint != tc.want {
				t.Fatalf("expected entrypoint %q, got %q", tc.want, detail.Meta.Entrypoint)
			}
		})
	}
}

func TestUploadDropAmbiguousEntrypoint(t *testing.T) {
	ctx := context.Background()

	t.Run("several pages without an index", func(t *testing.T) {
		svc, _ := newTestService(t)
		_, err := svc.UploadDrop(ctx, UploadDropInput{
			Title: "Ambiguo",
			Files: []UploadFile{
				uploadFile("about.html", "text/html", "x"),
				uploadFile("contact.html", "text/html", "x"),
			},
		})
		if !errors.Is(err, ErrEntrypointMissing) {
			t.Fatalf("expected ErrEntrypointMissing, got %v", err)
		}
		if !strings.Contains(err.Error(), "about.html") {
			t.Errorf("the error should name the candidates, got: %v", err)
		}
	})

	t.Run("no HTML at all", func(t *testing.T) {
		svc, _ := newTestService(t)
		_, err := svc.UploadDrop(ctx, UploadDropInput{
			Title: "Sin HTML",
			Files: []UploadFile{uploadFile("notas.txt", "text/plain", "x")},
		})
		if !errors.Is(err, ErrEntrypointMissing) {
			t.Fatalf("expected ErrEntrypointMissing, got %v", err)
		}
	})
}

func TestOpenPublicFile(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	detail, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Publicado",
		Files: []UploadFile{
			uploadFile("pagina.html", "text/html", "<h1>hola</h1>"),
			uploadFile("assets/app.css", "text/css", "body{}"),
		},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}
	slug := detail.Meta.Slug

	if detail.URL != "http://localhost:8000/d/"+slug+"/" {
		t.Fatalf("unexpected public URL: %q", detail.URL)
	}

	// No path resolves to the entrypoint, whatever it is called.
	body, info, err := svc.OpenPublicFile(ctx, slug, "")
	if err != nil {
		t.Fatalf("OpenPublicFile entrypoint: %v", err)
	}
	data, _ := io.ReadAll(body)
	body.Close()
	if string(data) != "<h1>hola</h1>" || info.Name != "pagina.html" {
		t.Fatalf("unexpected entrypoint response: %q %+v", data, info)
	}

	// A nested asset is reachable by its relative path.
	body, _, err = svc.OpenPublicFile(ctx, slug, "assets/app.css")
	if err != nil {
		t.Fatalf("OpenPublicFile asset: %v", err)
	}
	data, _ = io.ReadAll(body)
	body.Close()
	if string(data) != "body{}" {
		t.Errorf("unexpected asset body: %q", data)
	}

	// Unknown slug and unknown file both 404.
	if _, _, err := svc.OpenPublicFile(ctx, "nopeXXXX", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound for an unknown slug, got %v", err)
	}
	if _, _, err := svc.OpenPublicFile(ctx, slug, "no-existe.css"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound for an unknown file, got %v", err)
	}
	// Traversal cannot escape the drop.
	if _, _, err := svc.OpenPublicFile(ctx, slug, "../../etc/passwd"); !errors.Is(err, ErrInvalidPath) {
		t.Errorf("expected ErrInvalidPath, got %v", err)
	}
}

func TestContentTypeIsInferredWhenNotDeclared(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	detail, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Tipos",
		Files: []UploadFile{
			uploadFile("index.html", "", "<h1>x</h1>"),
			// What curl sends when the caller does not pass `;type=`.
			uploadFile("assets/app.css", "application/octet-stream", "body{}"),
			uploadFile("logo.svg", "", "<svg/>"),
			// An explicit type is respected as given.
			uploadFile("raw.bin", "application/x-custom", "\x00"),
		},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	got := map[string]string{}
	for _, f := range detail.Files {
		got[f.Name] = f.ContentType
	}
	want := map[string]string{
		"index.html":     "text/html; charset=utf-8",
		"assets/app.css": "text/css; charset=utf-8",
		"logo.svg":       "image/svg+xml",
		"raw.bin":        "application/x-custom",
	}
	for name, expected := range want {
		if got[name] != expected {
			t.Errorf("%s: expected %q, got %q", name, expected, got[name])
		}
	}
}

func TestUploadingTheSameTitleAgainOpensANewVersion(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	first, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Landing",
		Files: []UploadFile{
			uploadFile("index.html", "text/html", "<h1>uno</h1>"),
			uploadFile("assets/app.css", "text/css", "body{}"),
		},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}
	if first.Meta.Version != 1 {
		t.Fatalf("a freshly published drop should be version 1, got %d", first.Meta.Version)
	}
	slug := first.Meta.Slug

	// The same title lands on the same drop instead of colliding.
	second, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Landing",
		Files: []UploadFile{uploadFile("index.html", "text/html", "<h1>dos</h1>")},
	})
	if err != nil {
		t.Fatalf("re-uploading the same title should publish a new version: %v", err)
	}
	if second.Path != first.Path || second.Meta.Slug != slug {
		t.Fatalf("expected the same drop, got %q (%s)", second.Path, second.Meta.Slug)
	}
	if second.Meta.Version != 2 {
		t.Fatalf("expected version 2, got %d", second.Meta.Version)
	}
	if len(second.Versions) != 2 {
		t.Fatalf("expected two versions in the history, got %+v", second.Versions)
	}
	if !second.Versions[0].Current || second.Versions[0].Seq != 2 {
		t.Errorf("history should be newest first with 2 current: %+v", second.Versions)
	}

	// The drop's own URL serves what was just published...
	body, _, err := svc.OpenPublicFile(ctx, slug, "")
	if err != nil {
		t.Fatalf("OpenPublicFile current: %v", err)
	}
	data, _ := io.ReadAll(body)
	body.Close()
	if string(data) != "<h1>dos</h1>" {
		t.Errorf("the current version should be served, got %q", data)
	}

	// ...and version 1 keeps serving exactly what it published, assets included.
	body, _, err = svc.OpenPublicFile(ctx, slug, "@1/")
	if err != nil {
		t.Fatalf("OpenPublicFile @1: %v", err)
	}
	data, _ = io.ReadAll(body)
	body.Close()
	if string(data) != "<h1>uno</h1>" {
		t.Errorf("version 1 should be untouched, got %q", data)
	}

	body, _, err = svc.OpenPublicFile(ctx, slug, "@1/assets/app.css")
	if err != nil {
		t.Fatalf("version 1 should keep the asset the new version dropped: %v", err)
	}
	body.Close()

	// That asset is gone from the current version.
	if _, _, err := svc.OpenPublicFile(ctx, slug, "assets/app.css"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected the dropped asset to 404 on the current version, got %v", err)
	}

	// A version that was never published is not a URL.
	if _, _, err := svc.OpenPublicFile(ctx, slug, "@9/"); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound for an unknown version, got %v", err)
	}
}

func TestEditingFilesDoesNotOpenANewVersion(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	detail, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Editable",
		Files: []UploadFile{uploadFile("index.html", "text/html", "<h1>uno</h1>")},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	// Versions are cut by uploads, not by edits: saving a file in the admin
	// changes what version 1 contains rather than publishing a version 2.
	if _, err := svc.SaveFile(ctx, detail.Path, "index.html", strings.NewReader("<h1>dos</h1>"), 12, "text/html"); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}
	title := "Otro título"
	if _, err := svc.UpdateDropMeta(ctx, detail.Path, DropPatch{Title: &title}); err != nil {
		t.Fatalf("UpdateDropMeta: %v", err)
	}

	detail, err = svc.GetDrop(ctx, detail.Path)
	if err != nil {
		t.Fatalf("GetDrop: %v", err)
	}
	if detail.Meta.Version != 1 || len(detail.Versions) != 1 {
		t.Fatalf("editing should stay on version 1: version=%d history=%+v", detail.Meta.Version, detail.Versions)
	}
}

func TestActivateVersionRollsBackWithoutLosingHistory(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	first, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Rollback",
		Files: []UploadFile{uploadFile("index.html", "text/html", "<h1>uno</h1>")},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}
	if _, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Rollback",
		Files: []UploadFile{uploadFile("index.html", "text/html", "<h1>dos</h1>")},
	}); err != nil {
		t.Fatalf("second UploadDrop: %v", err)
	}

	detail, err := svc.ActivateVersion(ctx, first.Path, 1)
	if err != nil {
		t.Fatalf("ActivateVersion: %v", err)
	}
	if detail.Meta.Version != 1 {
		t.Fatalf("expected version 1 to be current, got %d", detail.Meta.Version)
	}
	// Rolling back moves a pointer; it does not discard what came after.
	if len(detail.Versions) != 2 {
		t.Fatalf("expected both versions to survive, got %+v", detail.Versions)
	}

	body, _, err := svc.OpenPublicFile(ctx, first.Meta.Slug, "")
	if err != nil {
		t.Fatalf("OpenPublicFile: %v", err)
	}
	data, _ := io.ReadAll(body)
	body.Close()
	if string(data) != "<h1>uno</h1>" {
		t.Errorf("expected version 1 to be served again, got %q", data)
	}

	// The newer version is still reachable by its own URL.
	body, _, err = svc.OpenPublicFile(ctx, first.Meta.Slug, "@2/")
	if err != nil {
		t.Fatalf("version 2 should still be reachable: %v", err)
	}
	body.Close()

	if _, err := svc.ActivateVersion(ctx, first.Path, 9); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound activating an unknown version, got %v", err)
	}
}

func TestUploadingOntoAPlainFolderStillCollides(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	if _, err := svc.CreateFolder(ctx, "", "informes"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	// Versioning applies to drops. A folder of the same name is a real clash.
	_, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Informes",
		Name:  "informes",
		Files: []UploadFile{uploadFile("index.html", "text/html", "x")},
	})
	if !errors.Is(err, ErrExists) {
		t.Fatalf("expected ErrExists, got %v", err)
	}
}

func TestRepublishingKeepsVisibilityUnlessAsked(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	first, err := svc.UploadDrop(ctx, UploadDropInput{
		Title:      "Privado",
		Visibility: model.VisibilityPrivate,
		Files:      []UploadFile{uploadFile("index.html", "text/html", "secreto")},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	// An upload that says nothing about visibility must not publish a private
	// drop to the world.
	second, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Privado",
		Files: []UploadFile{uploadFile("index.html", "text/html", "sigue siendo secreto")},
	})
	if err != nil {
		t.Fatalf("second UploadDrop: %v", err)
	}
	if second.Meta.Visibility != model.VisibilityPrivate {
		t.Fatalf("re-uploading must not reopen a private drop, got %q", second.Meta.Visibility)
	}
	if _, _, err := svc.OpenPublicFile(ctx, first.Meta.Slug, ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("the drop should still be hidden, got %v", err)
	}

	// Asking explicitly does change it.
	third, err := svc.UploadDrop(ctx, UploadDropInput{
		Title:      "Privado",
		Visibility: model.VisibilityPublic,
		Files:      []UploadFile{uploadFile("index.html", "text/html", "ya público")},
	})
	if err != nil {
		t.Fatalf("third UploadDrop: %v", err)
	}
	if third.Meta.Visibility != model.VisibilityPublic {
		t.Fatalf("expected public, got %q", third.Meta.Visibility)
	}
}

func TestDescriptorSizeMatchesItsBytes(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	detail, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Descriptor",
		Files: []UploadFile{
			uploadFile("index.html", "text/html", "<h1>hola</h1>"),
			uploadFile("assets/app.css", "text/css", "body{}"),
		},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	// The listed size and the served bytes must come from the same render: when
	// they drifted, the reported Content-Length outran the body and every
	// download of the descriptor was truncated.
	var listed FileInfo
	for _, f := range detail.Files {
		if f.Name == MetaFileName {
			listed = f
		}
	}
	if listed.Name == "" {
		t.Fatal("the descriptor should be listed")
	}

	body, info, err := svc.OpenFile(ctx, detail.Path+"/"+MetaFileName)
	if err != nil {
		t.Fatalf("OpenFile descriptor: %v", err)
	}
	data, _ := io.ReadAll(body)
	body.Close()

	if info.Size != int64(len(data)) {
		t.Errorf("descriptor reports %d bytes but served %d", info.Size, len(data))
	}
	if listed.Size != int64(len(data)) {
		t.Errorf("listing reports %d bytes but the descriptor is %d", listed.Size, len(data))
	}

	// It describes the version it belongs to, contents included, so a bundle
	// pulled straight out of storage still makes sense on its own.
	for _, want := range []string{"version: 1", "entrypoint: index.html", "path: assets/app.css"} {
		if !strings.Contains(string(data), want) {
			t.Errorf("descriptor missing %q:\n%s", want, data)
		}
	}
}

func TestOpenPublicFileHidesPrivateDrops(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	detail, err := svc.UploadDrop(ctx, UploadDropInput{
		Title:      "Privado",
		Visibility: model.VisibilityPrivate,
		Files:      []UploadFile{uploadFile("index.html", "text/html", "secreto")},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	// Not 403: a private drop must not confirm that its slug exists.
	if _, _, err := svc.OpenPublicFile(ctx, detail.Meta.Slug, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for a private drop, got %v", err)
	}

	// Publishing it makes it reachable without re-uploading anything.
	visibility := model.VisibilityPublic
	if _, err := svc.UpdateDropMeta(ctx, detail.Path, DropPatch{Visibility: &visibility}); err != nil {
		t.Fatalf("UpdateDropMeta: %v", err)
	}
	body, _, err := svc.OpenPublicFile(ctx, detail.Meta.Slug, "")
	if err != nil {
		t.Fatalf("expected the drop to be served once public: %v", err)
	}
	body.Close()
}

func TestUploadDropValidation(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	cases := []struct {
		name  string
		input UploadDropInput
		want  error
	}{
		{
			name:  "no files",
			input: UploadDropInput{Title: "Sin archivos"},
			want:  ErrInvalidPath,
		},
		{
			name:  "no title",
			input: UploadDropInput{Files: []UploadFile{uploadFile("index.html", "text/html", "x")}},
			want:  ErrInvalidPath,
		},
		{
			name: "entrypoint not uploaded",
			input: UploadDropInput{
				Title:      "Sin entrypoint",
				Entrypoint: "main.html",
				Files:      []UploadFile{uploadFile("index.html", "text/html", "x")},
			},
			want: ErrEntrypointMissing,
		},
		{
			name: "traversal in a file path",
			input: UploadDropInput{
				Title: "Hostil",
				Files: []UploadFile{uploadFile("../../etc/passwd", "text/plain", "x")},
			},
			want: ErrInvalidPath,
		},
		{
			name: "reserved descriptor name",
			input: UploadDropInput{
				Title: "Reservado",
				Files: []UploadFile{uploadFile("assets/"+MetaFileName, "text/plain", "x")},
			},
			want: ErrInvalidPath,
		},
		{
			name: "a path that would shadow a version reference",
			input: UploadDropInput{
				Title: "Arroba",
				Files: []UploadFile{uploadFile("@2/index.html", "text/html", "x")},
			},
			want: ErrInvalidPath,
		},
		{
			name: "duplicate paths",
			input: UploadDropInput{
				Title: "Duplicado",
				Files: []UploadFile{
					uploadFile("index.html", "text/html", "a"),
					uploadFile("./index.html", "text/html", "b"),
				},
			},
			want: ErrInvalidPath,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.UploadDrop(ctx, tc.input); !errors.Is(err, tc.want) {
				t.Fatalf("expected %v, got %v", tc.want, err)
			}
		})
	}

	// None of the rejected requests may have left a node behind.
	nodes, err := svc.List(ctx, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(nodes) != 0 {
		t.Fatalf("expected no drops created, got %+v", nodes)
	}
}

func TestUploadDropRollsBackOnStorageFailure(t *testing.T) {
	ctx := context.Background()
	svc, store := newTestService(t)

	// Fail the second file, after the drop and the first file already exist.
	store.failOn = "second.css"

	_, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Fallo a media subida",
		Files: []UploadFile{
			uploadFile("index.html", "text/html", "<h1>ok</h1>"),
			uploadFile("second.css", "text/css", "body{}"),
		},
	})
	if err == nil {
		t.Fatal("expected the upload to fail")
	}

	nodes, err := svc.List(ctx, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(nodes) != 0 {
		t.Fatalf("expected the drop to be rolled back, got %+v", nodes)
	}
	if keys := store.keys(); len(keys) != 0 {
		t.Fatalf("expected storage to be cleaned, got %v", keys)
	}
}

func TestAFailedRepublishLeavesThePublishedVersionAlone(t *testing.T) {
	ctx := context.Background()
	svc, store := newTestService(t)

	first, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Estable",
		Files: []UploadFile{uploadFile("index.html", "text/html", "<h1>publicado</h1>")},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	// Fail the second file of the new version, once the first already landed.
	store.failOn = "roto.css"
	if _, err := svc.UploadDrop(ctx, UploadDropInput{
		Title: "Estable",
		Files: []UploadFile{
			uploadFile("index.html", "text/html", "<h1>a medias</h1>"),
			uploadFile("roto.css", "text/css", "body{}"),
		},
	}); err == nil {
		t.Fatal("expected the upload to fail")
	}
	store.failOn = ""

	// The drop keeps serving what it was serving, and the half-written version
	// left nothing behind — neither a row nor an object.
	detail, err := svc.GetDrop(ctx, first.Path)
	if err != nil {
		t.Fatalf("GetDrop: %v", err)
	}
	if detail.Meta.Version != 1 || len(detail.Versions) != 1 {
		t.Fatalf("expected to stay on version 1: version=%d history=%+v", detail.Meta.Version, detail.Versions)
	}

	body, _, err := svc.OpenPublicFile(ctx, first.Meta.Slug, "")
	if err != nil {
		t.Fatalf("OpenPublicFile: %v", err)
	}
	data, _ := io.ReadAll(body)
	body.Close()
	if string(data) != "<h1>publicado</h1>" {
		t.Errorf("the published version should be untouched, got %q", data)
	}

	for _, key := range store.keys() {
		if strings.Contains(key, "/v2/") {
			t.Errorf("the discarded version left %s behind", key)
		}
	}
}

func TestPathTraversalRejected(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	for _, parent := range []string{"../etc", "a/../../b", "/etc/passwd", "a/../..", "..", "a/./../.."} {
		if _, err := svc.CreateFolder(ctx, parent, "x"); err != ErrInvalidPath {
			t.Errorf("parent=%q: expected ErrInvalidPath, got %v", parent, err)
		}
	}

	for _, name := range []string{"..", ".", "a/b", ".drop", "", "a\\b"} {
		if _, err := svc.CreateFolder(ctx, "", name); err != ErrInvalidPath {
			t.Errorf("name=%q: expected ErrInvalidPath, got %v", name, err)
		}
	}
}

func TestUploadDownloadAndDeleteFile(t *testing.T) {
	ctx := context.Background()
	svc, store := newTestService(t)

	if _, err := svc.CreateDrop(ctx, DropInput{Name: "site"}); err != nil {
		t.Fatalf("CreateDrop: %v", err)
	}

	const content = "<h1>hola</h1>"
	info, err := svc.SaveFile(ctx, "site", "index.html", strings.NewReader(content), int64(len(content)), "text/html")
	if err != nil {
		t.Fatalf("SaveFile: %v", err)
	}
	if info.Size != int64(len(content)) || info.ContentType != "text/html" {
		t.Fatalf("unexpected file info: %+v", info)
	}

	detail, err := svc.GetDrop(ctx, "site")
	if err != nil {
		t.Fatalf("GetDrop: %v", err)
	}
	if files := uploaded(detail.Files); len(files) != 1 || files[0].Name != "index.html" {
		t.Fatalf("unexpected files: %+v", detail.Files)
	}

	body, _, err := svc.OpenFile(ctx, "site/index.html")
	if err != nil {
		t.Fatalf("OpenFile: %v", err)
	}
	got, _ := io.ReadAll(body)
	body.Close()
	if string(got) != content {
		t.Fatalf("round-trip mismatch: %q", got)
	}

	// The reserved descriptor name cannot be overwritten through the file API.
	if _, err := svc.SaveFile(ctx, "site", MetaFileName, strings.NewReader("x"), 1, "text/plain"); err != ErrInvalidPath {
		t.Fatalf("expected ErrInvalidPath writing %s, got %v", MetaFileName, err)
	}

	// Re-uploading the same name replaces rather than duplicating.
	const updated = "<h1>hola de nuevo</h1>"
	if _, err := svc.SaveFile(ctx, "site", "index.html", strings.NewReader(updated), int64(len(updated)), "text/html"); err != nil {
		t.Fatalf("SaveFile replace: %v", err)
	}
	detail, err = svc.GetDrop(ctx, "site")
	if err != nil {
		t.Fatalf("GetDrop: %v", err)
	}
	if files := uploaded(detail.Files); len(files) != 1 {
		t.Fatalf("expected the file to be replaced, got %+v", detail.Files)
	}

	if err := svc.DeleteFile(ctx, "site/index.html"); err != nil {
		t.Fatalf("DeleteFile: %v", err)
	}
	detail, err = svc.GetDrop(ctx, "site")
	if err != nil {
		t.Fatalf("GetDrop: %v", err)
	}
	if files := uploaded(detail.Files); len(files) != 0 {
		t.Fatalf("expected no files, got %+v", detail.Files)
	}

	// The descriptor survives; only the uploaded object is gone.
	if keys := store.keys(); len(keys) != 1 || !strings.HasSuffix(keys[0], MetaFileName) {
		t.Fatalf("unexpected objects after delete: %v", keys)
	}
}

func TestUpdateDropMeta(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)

	if _, err := svc.CreateDrop(ctx, DropInput{Name: "site", Title: "Site"}); err != nil {
		t.Fatalf("CreateDrop: %v", err)
	}

	title := "Nuevo título"
	visibility := model.VisibilityPublic
	detail, err := svc.UpdateDropMeta(ctx, "site", DropPatch{Title: &title, Visibility: &visibility})
	if err != nil {
		t.Fatalf("UpdateDropMeta: %v", err)
	}
	if detail.Meta.Title != title || detail.Meta.Visibility != model.VisibilityPublic {
		t.Fatalf("unexpected meta: %+v", detail.Meta)
	}

	bogus := model.Visibility("banana")
	if _, err := svc.UpdateDropMeta(ctx, "site", DropPatch{Visibility: &bogus}); err == nil {
		t.Fatal("expected an error for an invalid visibility")
	}
}

func TestDeleteRecursiveRemovesObjects(t *testing.T) {
	ctx := context.Background()
	svc, store := newTestService(t)

	if _, err := svc.CreateFolder(ctx, "", "proyectos"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	if _, err := svc.CreateDrop(ctx, DropInput{Parent: "proyectos", Name: "site"}); err != nil {
		t.Fatalf("CreateDrop: %v", err)
	}
	if _, err := svc.SaveFile(ctx, "proyectos/site", "a.html", strings.NewReader("a"), 1, "text/html"); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}

	if err := svc.Delete(ctx, "proyectos"); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	nodes, err := svc.List(ctx, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(nodes) != 0 {
		t.Fatalf("expected an empty root, got %+v", nodes)
	}
	if keys := store.keys(); len(keys) != 0 {
		t.Fatalf("expected storage to be cleaned, got %v", keys)
	}

	if err := svc.Delete(ctx, ""); err != ErrInvalidPath {
		t.Fatalf("expected ErrInvalidPath deleting the root, got %v", err)
	}
}
