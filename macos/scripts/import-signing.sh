#!/bin/bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Signing import is scoped to GitHub Actions.' >&2; exit 1; }
: "${CSC_LINK:?Missing certificate}" "${CSC_KEY_PASSWORD:?Missing certificate password}" "${RUNNER_TEMP:?Missing runner temp}" "${GITHUB_ENV:?Missing environment file}"
openmtp_signing_dir="$(mktemp -d "$RUNNER_TEMP/openmtp-signing.XXXXXX")"
openmtp_certificate="$openmtp_signing_dir/certificate.p12"
trap 'rm -f "$openmtp_certificate"' EXIT
case "$CSC_LINK" in
  https://*) curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 "$CSC_LINK" -o "$openmtp_certificate" ;;
  *) printf '%s' "$CSC_LINK" | /usr/bin/base64 -D > "$openmtp_certificate" ;;
esac
openmtp_keychain="$openmtp_signing_dir/signing.keychain-db"
openmtp_keychain_password="$(openssl rand -hex 32)"
printf '::add-mask::%s\n' "$openmtp_keychain_password"
security create-keychain -p "$openmtp_keychain_password" "$openmtp_keychain"
security set-keychain-settings -lut 21600 "$openmtp_keychain"
security unlock-keychain -p "$openmtp_keychain_password" "$openmtp_keychain"
security import "$openmtp_certificate" -k "$openmtp_keychain" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$openmtp_keychain_password" "$openmtp_keychain" >/dev/null
openmtp_identity="$(security find-identity -v -p codesigning "$openmtp_keychain" | awk '/Developer ID Application/{print $2; exit}')"
[[ "$openmtp_identity" =~ ^[0-9A-Fa-f]{40}$ ]] || { echo 'No valid Developer ID Application certificate found.' >&2; exit 1; }
printf 'OPENMTP_SIGN_IDENTITY=%s\nOPENMTP_SIGN_KEYCHAIN=%s\n' "$openmtp_identity" "$openmtp_keychain" >> "$GITHUB_ENV"
