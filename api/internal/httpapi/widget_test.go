package httpapi

import (
	"strings"
	"testing"
)

func TestInjectWidgetBeforeBodyClose(t *testing.T) {
	page := []byte(`<!doctype html><html><body><h1>hola</h1></body></html>`)

	out, err := injectWidget(page, widgetData{Slug: "abc123", Title: "Mi documento", Version: 2})
	if err != nil {
		t.Fatalf("injectWidget: %v", err)
	}
	got := string(out)

	// The page's own markup must survive untouched...
	if !strings.Contains(got, "<h1>hola</h1>") {
		t.Error("the original content was lost")
	}
	// ...and the badge goes inside the body, before it closes, so the page's
	// own scripts have already run.
	body := strings.Index(got, "</body>")
	meta := strings.Index(got, `id="__drop_meta"`)
	if meta == -1 || body == -1 || meta > body {
		t.Fatalf("expected the badge before </body>:\n%s", got)
	}
	if !strings.Contains(got, `"slug":"abc123"`) || !strings.Contains(got, `"version":2`) {
		t.Errorf("metadata missing from the payload:\n%s", got)
	}
}

func TestInjectWidgetWithoutBodyTag(t *testing.T) {
	// A bare fragment is still valid published content.
	out, err := injectWidget([]byte(`<h1>solo esto</h1>`), widgetData{Slug: "abc123"})
	if err != nil {
		t.Fatalf("injectWidget: %v", err)
	}
	got := string(out)
	if !strings.HasPrefix(got, "<h1>solo esto</h1>") {
		t.Errorf("original content should come first:\n%s", got)
	}
	if !strings.Contains(got, `id="__drop_meta"`) {
		t.Error("the badge should still be appended")
	}
}

func TestInjectWidgetUppercaseBodyTag(t *testing.T) {
	out, err := injectWidget([]byte(`<HTML><BODY>x</BODY></HTML>`), widgetData{Slug: "abc123"})
	if err != nil {
		t.Fatalf("injectWidget: %v", err)
	}
	got := string(out)
	if strings.Index(got, `id="__drop_meta"`) > strings.Index(strings.ToLower(got), "</body>") {
		t.Errorf("uppercase </BODY> should be matched too:\n%s", got)
	}
}

func TestInjectWidgetEscapesTitleForScriptContext(t *testing.T) {
	// A title carrying markup must not be able to close the script element it
	// is embedded in.
	hostile := `</script><script>alert(1)</script>`
	out, err := injectWidget([]byte(`<body></body>`), widgetData{Slug: "abc123", Title: hostile})
	if err != nil {
		t.Fatalf("injectWidget: %v", err)
	}
	got := string(out)
	if strings.Contains(got, hostile) {
		t.Fatalf("the hostile title was embedded verbatim:\n%s", got)
	}
	if !strings.Contains(got, `</script>`) {
		t.Errorf("expected the markup to be unicode-escaped:\n%s", got)
	}
}

func TestIsHTMLContentType(t *testing.T) {
	cases := map[string]bool{
		"text/html":                true,
		"text/html; charset=utf-8": true,
		"TEXT/HTML":                true,
		" text/html ":              true,
		"text/css; charset=utf-8":  false,
		"application/json":         false,
		"image/svg+xml":            false,
		"application/octet-stream": false,
		"text/htmlish":             false,
		"":                         false,
	}
	for contentType, want := range cases {
		if got := isHTMLContentType(contentType); got != want {
			t.Errorf("%q: expected %v, got %v", contentType, want, got)
		}
	}
}
