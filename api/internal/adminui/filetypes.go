package adminui

import (
	"strings"
)

// FileType is how a stored file is presented: which icon and colour it gets in
// the listing, and whether the editor can open it at all.
type FileType struct {
	// Label is the short badge shown next to the name.
	Label string
	// Icon names an entry of iconPaths.
	Icon string
	// Class colours the icon; defined in the stylesheet.
	Class string
	// Editable marks contents the editor can load as text.
	Editable bool
	// Image marks contents the editor can show as a preview.
	Image bool
	// ContentType is what an edit-and-save writes back.
	ContentType string
}

var unknownType = FileType{
	Label:       "FILE",
	Icon:        "file",
	Class:       "ft-muted",
	ContentType: "application/octet-stream",
}

var fileTypes = map[string]FileType{
	"html":  {Label: "HTML", Icon: "file-code", Class: "ft-orange", Editable: true, ContentType: "text/html"},
	"css":   {Label: "CSS", Icon: "file-code", Class: "ft-sky", Editable: true, ContentType: "text/css"},
	"js":    {Label: "JS", Icon: "file-code", Class: "ft-yellow", Editable: true, ContentType: "text/javascript"},
	"ts":    {Label: "TS", Icon: "file-code", Class: "ft-blue", Editable: true, ContentType: "text/typescript"},
	"jsx":   {Label: "JSX", Icon: "file-code", Class: "ft-cyan", Editable: true, ContentType: "text/javascript"},
	"tsx":   {Label: "TSX", Icon: "file-code", Class: "ft-cyan", Editable: true, ContentType: "text/typescript"},
	"json":  {Label: "JSON", Icon: "file-json", Class: "ft-amber", Editable: true, ContentType: "application/json"},
	"md":    {Label: "MD", Icon: "file-text", Class: "ft-slate", Editable: true, ContentType: "text/markdown"},
	"txt":   {Label: "TXT", Icon: "file-text", Class: "ft-muted", Editable: true, ContentType: "text/plain"},
	"yaml":  {Label: "YAML", Icon: "file-cog", Class: "ft-violet", Editable: true, ContentType: "application/yaml"},
	"svg":   {Label: "SVG", Icon: "file-image", Class: "ft-emerald", Editable: true, Image: true, ContentType: "image/svg+xml"},
	"xml":   {Label: "XML", Icon: "file-code", Class: "ft-emerald", Editable: true, ContentType: "application/xml"},
	"png":   {Label: "PNG", Icon: "file-image", Class: "ft-emerald", Image: true, ContentType: "image/png"},
	"jpg":   {Label: "JPG", Icon: "file-image", Class: "ft-emerald", Image: true, ContentType: "image/jpeg"},
	"gif":   {Label: "GIF", Icon: "file-image", Class: "ft-emerald", Image: true, ContentType: "image/gif"},
	"webp":  {Label: "WEBP", Icon: "file-image", Class: "ft-emerald", Image: true, ContentType: "image/webp"},
	"ico":   {Label: "ICO", Icon: "file-image", Class: "ft-emerald", Image: true, ContentType: "image/x-icon"},
	"pdf":   {Label: "PDF", Icon: "file-text", Class: "ft-red", ContentType: "application/pdf"},
	"zip":   {Label: "ZIP", Icon: "file-archive", Class: "ft-muted", ContentType: "application/zip"},
	"woff":  {Label: "FONT", Icon: "file-type", Class: "ft-muted", ContentType: "font/woff"},
	"woff2": {Label: "FONT", Icon: "file-type", Class: "ft-muted", ContentType: "font/woff2"},
}

var typeAliases = map[string]string{
	"htm":      "html",
	"mjs":      "js",
	"cjs":      "js",
	"jpeg":     "jpg",
	"yml":      "yaml",
	"markdown": "md",
	"ttf":      "woff",
	"otf":      "woff",
}

// TypeOf classifies a file by name. The ".drop" descriptor has no extension, so
// it is matched by name and treated as the YAML it is.
func TypeOf(name string) FileType {
	if name == ".drop" {
		t := fileTypes["yaml"]
		t.Label = "DROP"
		t.Class = "ft-primary"
		return t
	}
	ext := ""
	if i := strings.LastIndex(name, "."); i >= 0 {
		ext = strings.ToLower(name[i+1:])
	}
	if alias, ok := typeAliases[ext]; ok {
		ext = alias
	}
	if t, ok := fileTypes[ext]; ok {
		return t
	}
	t := unknownType
	if ext != "" {
		t.Label = strings.ToUpper(ext)
	}
	return t
}
