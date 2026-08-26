package httpapi

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"mime"
	"strings"
	"time"

	"drop/internal/service"
)

//go:embed assets/widget.js
var widgetScript string

// maxInjectableHTML caps how much of a page is buffered to inject the badge.
// Beyond it the response is streamed untouched: holding a huge document in
// memory to append a script is a worse trade than skipping the badge.
const maxInjectableHTML = 2 << 20 // 2 MiB

// widgetData is what the badge shows. It deliberately omits the drop's path in
// the admin tree, which would leak how the account organizes its content.
type widgetData struct {
	Slug       string `json:"slug"`
	Title      string `json:"title"`
	Entrypoint string `json:"entrypoint"`
	Visibility string `json:"visibility"`
	// Version is the snapshot this page belongs to, which is Current unless
	// the URL pinned an older one.
	Version uint `json:"version"`
	Current uint `json:"current"`
	Pinned  bool `json:"pinned"`
	// URL is where the drop's current version lives, so a page serving an old
	// version can link back to the latest one.
	URL       string              `json:"url"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
	Files     []widgetFileData    `json:"files"`
	Versions  []widgetVersionData `json:"versions"`
}

type widgetFileData struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	// Type is the stored content type. The badge could guess one from the
	// extension, but it decides whether a file is previewable and how — and a
	// ".bin" that is really a PNG, or an extensionless file, would be guessed
	// wrong. What the API stored is the answer.
	Type string `json:"type"`
}

type widgetVersionData struct {
	Seq         uint      `json:"seq"`
	Files       int       `json:"files"`
	Size        int64     `json:"size"`
	Current     bool      `json:"current"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"published_at"`
}

func newWidgetData(published service.PublishedVersion) widgetData {
	detail := published.Detail

	// The ".drop" descriptor is an admin-side artifact: it has no row to serve,
	// so listing it here would offer the visitor a link that 404s.
	files := make([]widgetFileData, 0, len(published.Files))
	for _, f := range published.Files {
		if f.Generated {
			continue
		}
		files = append(files, widgetFileData{Name: f.Name, Size: f.Size, Type: f.ContentType})
	}

	versions := make([]widgetVersionData, 0, len(detail.Versions))
	entrypoint := detail.Meta.Entrypoint
	for _, v := range detail.Versions {
		versions = append(versions, widgetVersionData{
			Seq:         v.Seq,
			Files:       v.Files,
			Size:        v.Size,
			Current:     v.Current,
			URL:         v.URL,
			PublishedAt: v.PublishedAt,
		})
		if v.Seq == published.Seq {
			entrypoint = v.Entrypoint
		}
	}

	return widgetData{
		Slug:       detail.Meta.Slug,
		Title:      detail.Meta.Title,
		Entrypoint: entrypoint,
		Visibility: string(detail.Meta.Visibility),
		Version:    published.Seq,
		Current:    detail.Meta.Version,
		Pinned:     published.Pinned,
		URL:        detail.URL,
		CreatedAt:  detail.Meta.CreatedAt,
		UpdatedAt:  detail.Meta.UpdatedAt,
		Files:      files,
		Versions:   versions,
	}
}

// injectWidget appends the badge to an HTML document, before </body> when there
// is one so the page's own scripts have already run. The metadata is inlined
// because published pages run in an opaque origin and cannot call the API back.
func injectWidget(page []byte, data widgetData) ([]byte, error) {
	// json.Marshal escapes <, > and & by default, so the payload cannot break
	// out of the script element it is embedded in.
	payload, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	var snippet bytes.Buffer
	snippet.WriteString(`<script type="application/json" id="__drop_meta">`)
	snippet.Write(payload)
	snippet.WriteString("</script>\n<script>")
	snippet.WriteString(widgetScript)
	snippet.WriteString("</script>")

	if i := lastIndexFold(page, "</body>"); i >= 0 {
		out := make([]byte, 0, len(page)+snippet.Len())
		out = append(out, page[:i]...)
		out = append(out, snippet.Bytes()...)
		out = append(out, page[i:]...)
		return out, nil
	}
	return append(page, snippet.Bytes()...), nil
}

// lastIndexFold finds the last case-insensitive occurrence of tag.
func lastIndexFold(haystack []byte, tag string) int {
	return strings.LastIndex(strings.ToLower(string(haystack)), tag)
}

// isHTMLContentType reports whether a response is an HTML document. It parses
// the media type rather than matching a prefix, so "text/htmlish" is not
// mistaken for HTML while "text/html; charset=utf-8" still is.
func isHTMLContentType(contentType string) bool {
	parsed, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil {
		return false
	}
	return parsed == "text/html"
}
