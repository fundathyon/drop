package auth

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
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
	private, err := loadPrivateKey(privatePath)
	if err != nil {
		return nil, err
	}
	public, err := loadPublicKey(publicPath)
	if err != nil {
		return nil, err
	}

	if private.N.BitLen() < minKeySize {
		return nil, fmt.Errorf("private key is %d bits, need at least %d", private.N.BitLen(), minKeySize)
	}
	// A mismatched pair fails at the worst possible moment: tokens are issued
	// happily and rejected by every verifier. Catch it at startup instead.
	if !private.PublicKey.Equal(public) {
		return nil, fmt.Errorf("%s and %s are not a keypair", privatePath, publicPath)
	}

	return &Keys{Private: private, Public: public}, nil
}

func loadPrivateKey(path string) (*rsa.PrivateKey, error) {
	block, err := readPEM(path)
	if err != nil {
		return nil, err
	}

	// PKCS#8 is what `openssl genpkey` writes; PKCS#1 is what the older
	// `openssl genrsa` writes. Both are common enough to accept.
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("%s holds a %T, not an RSA private key", path, key)
		}
		return rsaKey, nil
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private key %s: %w", path, err)
	}
	return key, nil
}

func loadPublicKey(path string) (*rsa.PublicKey, error) {
	block, err := readPEM(path)
	if err != nil {
		return nil, err
	}

	if key, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("%s holds a %T, not an RSA public key", path, key)
		}
		return rsaKey, nil
	}
	key, err := x509.ParsePKCS1PublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key %s: %w", path, err)
	}
	return key, nil
}

func readPEM(path string) (*pem.Block, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%s does not exist; generate the keypair with `make keys`", path)
		}
		return nil, err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("%s is not PEM-encoded", path)
	}
	return block, nil
}
