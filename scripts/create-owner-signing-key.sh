#!/usr/bin/env bash
# Generate an Android signing keystore without printing its private key or
# password. Choose a private output directory OUTSIDE version control.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -e "$1" ] || [ -L "$1" ]; then
  echo 'Usage: create-owner-signing-key.sh NEW_PRIVATE_OUTPUT_DIRECTORY' >&2
  exit 1
fi
command -v openssl >/dev/null || { echo 'OpenSSL is required.' >&2; exit 1; }
umask 077
mkdir -m 700 "$1"
VAULT=$(cd "$1" && pwd -P)
PASSWORD="$VAULT/keystore-password.txt"
PRIVATE="$VAULT/encrypted-private-key.pem"
CERT="$VAULT/certificate.pem"
KEYSTORE="$VAULT/printly-owner-release.p12"
INFO="$VAULT/signing-info.txt"
complete=false
cleanup() {
  # The temporary PEM is itself encrypted. Never leave incomplete credentials.
  rm -f "$PRIVATE"
  if [ "$complete" != true ]; then
    rm -f "$PASSWORD" "$KEYSTORE" "$CERT" "$INFO" "$VAULT/creation.log"
    rmdir "$VAULT" 2>/dev/null || true
  fi
}
trap cleanup EXIT
openssl rand -hex 32 > "$PASSWORD"
openssl genpkey -algorithm RSA -aes-256-cbc -pass "file:$PASSWORD" \
  -pkeyopt rsa_keygen_bits:3072 -out "$PRIVATE" 2> "$VAULT/creation.log"
openssl req -new -x509 -sha256 -days 10950 -subj '/CN=Printly for Shops' \
  -key "$PRIVATE" -passin "file:$PASSWORD" -out "$CERT"
# Use separate file descriptors so OpenSSL reads the password independently
# for the input PEM and output PKCS12 (a single shared source expects two lines).
openssl pkcs12 -export -name printly-owner-release -in "$CERT" -inkey "$PRIVATE" \
  -iter 210000 -macalg sha256 -passin fd:3 -passout fd:4 -out "$KEYSTORE" 3< "$PASSWORD" 4< "$PASSWORD"
# Verify the certificate and private key can be read from the new keystore.
original=$(openssl x509 -in "$CERT" -noout -fingerprint -sha256 | cut -d= -f2)
extracted=$(openssl pkcs12 -in "$KEYSTORE" -passin "file:$PASSWORD" -clcerts -nokeys | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2)
[ "$original" = "$extracted" ] || { echo 'Keystore certificate verification failed.' >&2; exit 1; }
openssl pkcs12 -in "$KEYSTORE" -passin "file:$PASSWORD" -nocerts -noenc | openssl pkey -check -noout > /dev/null
printf '%s\n' 'Package: io.github.dawartariq.printly.owner' 'Keystore type: PKCS12' 'Alias: printly-owner-release' \
  "Certificate SHA-256: $original" > "$INFO"
openssl x509 -in "$CERT" -noout -dates >> "$INFO"
rm -f "$VAULT/creation.log"
complete=true
echo 'Created a password-protected PKCS12 keystore and public verification information in the private output directory.'
