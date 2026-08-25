#!/bin/sh
# Passthrough seam shared by every runtime target in the root Dockerfile.
# It does nothing today on purpose: having ENTRYPOINT already point here means
# a future pre-start step (waiting on MinIO, running a migration, picking
# between several binaries in the image) can be added without changing the
# image contract or every compose file's `command:`.
set -e

exec "$@"
