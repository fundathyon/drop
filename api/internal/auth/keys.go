package auth

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strings"
)

// minKeySize rejects a keypair too small to be worth signing with. 2048 bits is
// the floor every current recommendation agrees on.
const minKeySize = 2048

// Keys is the RSA keypair tokens are signed and verified with.
//
// Signing is asymmetric on purpose: a shared secret (HS256) would mean anything
// able to verify a token is also able to mint one, so the verifying side could
// never be given out. With RS256 only this process needs the private key.
type Keys struct {
	Private *rsa.PrivateKey
	Public  *rsa.PublicKey
}

// LoadKeys reads a PEM keypair from disk.
func LoadKeys(privatePath, publicPath string) (*Keys, error) {
	privatePEM, err := readPEMFile(privatePath)
	if err != nil {
		return nil, err
	}
	publicPEM, err := readPEMFile(publicPath)
	if err != nil {
		return nil, err
	}
	return newKeys(privatePEM, publicPEM, privatePath, publicPath)
}

// KeysFromPEM builds a keypair from PEM-encoded key material already in
// memory, for deployments that inject the keypair through environment
// variables (PRIVATE_KEY_JWT/PUBLIC_KEY_JWT) rather than mounting files —
// some hosting platforms only offer the former. The line breaks a multi-line
// PEM needs rarely survive a single-line env var field intact, so this
// recovers them however they came through: as literal `\n` escapes, or —
// Dokploy does this — collapsed to plain spaces, which loses the line
// structure entirely and has to be rebuilt from the PEM grammar itself.
func KeysFromPEM(privatePEM, publicPEM []byte) (*Keys, error) {
	return newKeys(normalizePEM(privatePEM), normalizePEM(publicPEM),
		"PRIVATE_KEY_JWT", "PUBLIC_KEY_JWT")
}

// normalizePEM tries each known way a PEM value comes back mangled, in order
// from least to most destructive to undo, stopping as soon as one decodes.
func normalizePEM(raw []byte) []byte {
	if block, _ := pem.Decode(raw); block != nil {
		return raw
	}
	unescaped := []byte(strings.ReplaceAll(string(raw), `\n`, "\n"))
	if block, _ := pem.Decode(unescaped); block != nil {
		return unescaped
	}
	return rewrapSpaceCollapsedPEM(unescaped)
}

// rewrapSpaceCollapsedPEM rebuilds line breaks in a PEM whose newlines were
// all replaced with spaces. The header/footer ("-----BEGIN RSA PRIVATE
// KEY-----") is itself made of space-separated words, so the split can't
// just be "one line per space" — instead it looks for the token that ends
// the "-----BEGIN ...-----" marker and the token that starts the
// "-----END ...-----" one, and treats everything between them as one
// base64 line per token, which is how it was wrapped before losing its
// newlines (the base64 alphabet itself never contains spaces).
func rewrapSpaceCollapsedPEM(raw []byte) []byte {
	fields := strings.Fields(string(raw))

	headerEnd := -1
	for i, f := range fields {
		if i > 0 && strings.HasSuffix(f, "-----") {
			headerEnd = i
			break
		}
	}
	if headerEnd == -1 {
		return raw
	}

	footerStart := -1
	for i := headerEnd + 1; i < len(fields); i++ {
		if strings.HasPrefix(fields[i], "-----END") {
			footerStart = i
			break
		}
	}
	if footerStart == -1 {
		return raw
	}

	lines := make([]string, 0, footerStart-headerEnd+2)
	lines = append(lines, strings.Join(fields[:headerEnd+1], " "))
	lines = append(lines, fields[headerEnd+1:footerStart]...)
	lines = append(lines, strings.Join(fields[footerStart:], " "))

	return []byte(strings.Join(lines, "\n") + "\n")
}

// newKeys parses and validates a keypair already in memory. privateSource and
// publicSource name where each half came from, purely for error messages —
// a file path for LoadKeys, an environment variable name for KeysFromPEM.
func newKeys(privatePEM, publicPEM []byte, privateSource, publicSource string) (*Keys, error) {
	private, err := parsePrivateKey(privatePEM, privateSource)
	if err != nil {
		return nil, err
	}
	public, err := parsePublicKey(publicPEM, publicSource)
	if err != nil {
		return nil, err
	}

	if private.N.BitLen() < minKeySize {
		return nil, fmt.Errorf("private key is %d bits, need at least %d", private.N.BitLen(), minKeySize)
	}
	// A mismatched pair fails at the worst possible moment: tokens are issued
	// happily and rejected by every verifier. Catch it at startup instead.
	if !private.PublicKey.Equal(public) {
		return nil, fmt.Errorf("%s and %s are not a keypair", privateSource, publicSource)
	}

	return &Keys{Private: private, Public: public}, nil
}

func parsePrivateKey(raw []byte, source string) (*rsa.PrivateKey, error) {
	block, err := decodePEM(raw, source)
	if err != nil {
		return nil, err
	}

	// PKCS#8 is what `openssl genpkey` writes; PKCS#1 is what the older
	// `openssl genrsa` writes. Both are common enough to accept.
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("%s holds a %T, not an RSA private key", source, key)
		}
		return rsaKey, nil
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key %s: %w", source, err)
	}
	return key, nil
}

func parsePublicKey(raw []byte, source string) (*rsa.PublicKey, error) {
	block, err := decodePEM(raw, source)
	if err != nil {
		return nil, err
	}

	if key, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("%s holds a %T, not an RSA public key", source, key)
		}
		return rsaKey, nil
	}
	key, err := x509.ParsePKCS1PublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key %s: %w", source, err)
	}
	return key, nil
}

func readPEMFile(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%s does not exist; generate the keypair with `make keys`", path)
		}
		return nil, err
	}
	return raw, nil
}

func decodePEM(raw []byte, source string) (*pem.Block, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("%s is not PEM-encoded", source)
	}
	return block, nil
}
