package service

import (
	"path"
	"strings"
)

// MetaFileName is the reserved object name holding a drop's metadata.
const MetaFileName = ".drop"

// cleanPath normalizes a caller-supplied path into slash form with no leading
// slash and no "." or ".." segments. An empty result means the tree root.
func cleanPath(rel string) (string, error) {
	if strings.ContainsRune(rel, 0) {
		return "", ErrInvalidPath
	}
	rel = strings.ReplaceAll(rel, "\\", "/")
	if strings.HasPrefix(rel, "/") {
		return "", ErrInvalidPath
	}
	// Clean as a relative path (never rooted): Clean() on a rooted path
	// silently collapses excess ".." at the root, which would let "../../x"
	// resolve to the root instead of being rejected.
	cleaned := path.Clean(rel)
	if cleaned == "." {
		return "", nil
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", ErrInvalidPath
	}
	return cleaned, nil
}

// validName checks a single path segment supplied by a caller — a folder,
// drop, or file name, never a full path.
func validName(name string) error {
	if name == "" || name == "." || name == ".." {
		return ErrInvalidPath
	}
	if strings.ContainsAny(name, "/\\") || strings.ContainsRune(name, 0) {
		return ErrInvalidPath
	}
	if name == MetaFileName {
		return ErrInvalidPath
	}
	return nil
}

// validFilePath normalizes a file path relative to a drop's root. Unlike
// validName it allows subdirectories ("assets/app.css"), because a real HTML
// bundle needs them — but every segment is still checked, so no traversal,
// empty segment, or reserved descriptor name can slip through.
func validFilePath(p string) (string, error) {
	if p == "" || strings.ContainsRune(p, 0) {
		return "", ErrInvalidPath
	}
	p = strings.ReplaceAll(p, "\\", "/")
	if strings.HasPrefix(p, "/") {
		return "", ErrInvalidPath
	}
	cleaned := path.Clean(p)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", ErrInvalidPath
	}
	for _, seg := range strings.Split(cleaned, "/") {
		// ".drop" is rejected at every level, not just the root: one reserved
		// name is easier to reason about than a positional rule.
		if seg == "" || seg == "." || seg == ".." || seg == MetaFileName {
			return "", ErrInvalidPath
		}
	}
	return cleaned, nil
}

// slugifyName turns a human title into a usable folder name.
func slugifyName(title string) string {
	var b strings.Builder
	lastDash := true // trims leading dashes
	for _, r := range strings.ToLower(strings.TrimSpace(title)) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case r >= 0x00C0 && r <= 0x024F: // keep accented latin letters readable
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	name := strings.Trim(b.String(), "-")
	if name == "" || name == MetaFileName {
		return "drop"
	}
	return name
}

func joinPath(parent, name string) string {
	if parent == "" {
		return name
	}
	return parent + "/" + name
}

// splitPath separates a path into its parent and its last segment.
func splitPath(p string) (parent, base string) {
	i := strings.LastIndex(p, "/")
	if i == -1 {
		return "", p
	}
	return p[:i], p[i+1:]
}
