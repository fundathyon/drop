// Package auth holds the pieces authentication is built from: password
// hashing, the RSA keypair, and the tokens issued from it.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

var (
	// ErrPasswordMismatch means the password does not match the stored hash.
	ErrPasswordMismatch = errors.New("password does not match")
	// ErrHashFormat means the stored value is not a hash this package wrote.
	ErrHashFormat = errors.New("unrecognized password hash")
)

// argon2Params are the cost settings new hashes are written with. They are
// encoded into every hash, so raising them later keeps old hashes verifiable —
// which is the whole reason for using the PHC string format rather than storing
// the raw digest.
type argon2Params struct {
	memory      uint32 // KiB
	iterations  uint32
	parallelism uint8
	saltLength  uint32
	keyLength   uint32
}

// defaultParams follow the OWASP recommendation for Argon2id: 19 MiB of
// memory, two iterations, one lane.
var defaultParams = argon2Params{
	memory:      19 * 1024,
	iterations:  2,
	parallelism: 1,
	saltLength:  16,
	keyLength:   32,
}

// HashPassword derives an Argon2id hash, encoded in the PHC string format so it
// carries its own parameters.
func HashPassword(password string) (string, error) {
	p := defaultParams

	salt := make([]byte, p.saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	key := argon2.IDKey([]byte(password), salt, p.iterations, p.memory, p.parallelism, p.keyLength)

	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.memory, p.iterations, p.parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword checks a password against a stored hash, using the parameters
// recorded in the hash itself rather than today's defaults.
func VerifyPassword(password, encoded string) error {
	p, salt, want, err := decodeHash(encoded)
	if err != nil {
		return err
	}

	got := argon2.IDKey([]byte(password), salt, p.iterations, p.memory, p.parallelism, uint32(len(want)))

	// Constant time: a byte-by-byte comparison leaks how much of the hash
	// matched, which is enough to reconstruct it one byte at a time.
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}

func decodeHash(encoded string) (argon2Params, []byte, []byte, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return argon2Params{}, nil, nil, ErrHashFormat
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return argon2Params{}, nil, nil, ErrHashFormat
	}
	if version != argon2.Version {
		return argon2Params{}, nil, nil, fmt.Errorf("%w: argon2 version %d", ErrHashFormat, version)
	}

	var p argon2Params
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.iterations, &p.parallelism); err != nil {
		return argon2Params{}, nil, nil, ErrHashFormat
	}

	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil {
		return argon2Params{}, nil, nil, ErrHashFormat
	}
	key, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil {
		return argon2Params{}, nil, nil, ErrHashFormat
	}

	p.saltLength = uint32(len(salt))
	p.keyLength = uint32(len(key))
	return p, salt, key, nil
}
