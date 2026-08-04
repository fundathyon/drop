# The SQLite driver (modernc.org/sqlite) is pure Go, so the binary needs no
# C toolchain and no libc at runtime — CGO_ENABLED=0 and a scratch-adjacent
# base both fall out of that for free.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /dropd ./cmd/dropd

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /dropd /usr/local/bin/dropd
EXPOSE 8000
ENTRYPOINT ["dropd"]
