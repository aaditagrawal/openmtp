#!/bin/bash
# Use the checksum-verified Sparkle tools resolved by SwiftPM, never a PATH tool.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${OPENMTP_SPARKLE_PRIVATE_KEY:?Missing Sparkle signing key}"
openmtp_version="$(tr -d '\n\r' < VERSION)"
openmtp_arch="${OPENMTP_ARCH:-$(uname -m)}"
case "$openmtp_arch" in arm64|x86_64) ;; *) exit 1 ;; esac
openmtp_name="OpenMTP-${openmtp_version}-macos-${openmtp_arch}"
openmtp_tools=".build/artifacts/sparkle/Sparkle/bin"
openmtp_tmp="$(mktemp -d appcast-stage.XXXXXX)"
trap 'rm -rf "$openmtp_tmp"' EXIT
test "$(/usr/libexec/PlistBuddy -c 'Print OpenMTPAutomaticUpdatesEnabled' build/OpenMTP.app/Contents/Info.plist)" = true
# Verify with the public key that clients will actually trust. Verifying only
# with the signing secret would accept mismatched CI public/private settings.
openmtp_public_key="$(/usr/libexec/PlistBuddy -c 'Print SUPublicEDKey' build/OpenMTP.app/Contents/Info.plist)"
openmtp_signature="$(printf '%s' "$OPENMTP_SPARKLE_PRIVATE_KEY" | "$openmtp_tools/sign_update" --ed-key-file - -p "../dist/${openmtp_name}.zip")"
swift - "../dist/${openmtp_name}.zip" "$openmtp_public_key" "$openmtp_signature" <<'SWIFT'
import CryptoKit
import Foundation
guard CommandLine.arguments.count == 4,
      let key = Data(base64Encoded: CommandLine.arguments[2]),
      let signature = Data(base64Encoded: CommandLine.arguments[3]),
      let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: key),
      let payload = try? Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])),
      publicKey.isValidSignature(signature, for: payload) else {
    fputs("Sparkle signing key does not match the app's embedded public key.\n", stderr)
    exit(1)
}
SWIFT
cp "../dist/${openmtp_name}.zip" "$openmtp_tmp/"
cp RELEASE_NOTES.md "$openmtp_tmp/${openmtp_name}.md"
openmtp_options=(--ed-key-file - --embed-release-notes --maximum-deltas 0
  --download-url-prefix "https://github.com/aaditagrawal/openmtp/releases/download/v${openmtp_version}/"
  --link "https://github.com/aaditagrawal/openmtp/releases/tag/v${openmtp_version}"
  -o "../dist/appcast-${openmtp_arch}.xml")
[[ "$openmtp_version" != *-* ]] || openmtp_options+=(--channel beta)
printf '%s' "$OPENMTP_SPARKLE_PRIVATE_KEY" | "$openmtp_tools/generate_appcast" "${openmtp_options[@]}" "$openmtp_tmp"
# Verify the generated feed with the same key before publishing any asset.
printf '%s' "$OPENMTP_SPARKLE_PRIVATE_KEY" | "$openmtp_tools/sign_update" --ed-key-file - --verify "../dist/appcast-${openmtp_arch}.xml"
test -s "../dist/appcast-${openmtp_arch}.xml"
