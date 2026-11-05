#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
openmtp_version="$(tr -d '\n\r' < VERSION)"
openmtp_arch="${OPENMTP_ARCH:-$(uname -m)}"
case "$openmtp_arch" in arm64|x86_64|universal) ;; *) exit 1 ;; esac
openmtp_name="OpenMTP-${openmtp_version}-macos-${openmtp_arch}"
openmtp_app="build/OpenMTP.app"
openmtp_dist="../dist"
[[ -d "$openmtp_app" ]] || { echo 'Run make build before packaging.' >&2; exit 1; }
codesign --verify --strict --deep "$openmtp_app"
mkdir -p "$openmtp_dist"
openmtp_tmp="$(mktemp -d package-stage.XXXXXX)"
trap 'rm -rf "$openmtp_tmp"' EXIT
# Notarize the Developer ID app before constructing its final ZIP and DMG.
if [[ "${OPENMTP_NOTARIZE:-0}" == 1 ]]; then
  [[ -n "${APPLEID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]] || { echo 'Notarization credentials are missing.' >&2; exit 1; }
  ditto -c -k --sequesterRsrc --keepParent "$openmtp_app" "$openmtp_tmp/notarize.zip"
  xcrun notarytool submit "$openmtp_tmp/notarize.zip" --apple-id "$APPLEID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$openmtp_app"
  xcrun stapler validate "$openmtp_app"
fi
ditto -c -k --sequesterRsrc --keepParent "$openmtp_app" "$openmtp_dist/${openmtp_name}.zip"
mkdir "$openmtp_tmp/disk"
ditto "$openmtp_app" "$openmtp_tmp/disk/OpenMTP.app"
ln -s /Applications "$openmtp_tmp/disk/Applications"
hdiutil create -ov -format UDZO -volname OpenMTP -srcfolder "$openmtp_tmp/disk" "$openmtp_dist/${openmtp_name}.dmg"
openmtp_signing=adhoc
if [[ -n "${OPENMTP_SIGN_IDENTITY:-}" && "$OPENMTP_SIGN_IDENTITY" != - ]]; then
  openmtp_signing=developer-id
  openmtp_dmg_flags=(--force --sign "$OPENMTP_SIGN_IDENTITY" --timestamp)
  [[ -z "${OPENMTP_SIGN_KEYCHAIN:-}" ]] || openmtp_dmg_flags+=(--keychain "$OPENMTP_SIGN_KEYCHAIN")
  codesign "${openmtp_dmg_flags[@]}" "$openmtp_dist/${openmtp_name}.dmg"
  if [[ "${OPENMTP_NOTARIZE:-0}" == 1 ]]; then
    xcrun notarytool submit "$openmtp_dist/${openmtp_name}.dmg" --apple-id "$APPLEID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    xcrun stapler staple "$openmtp_dist/${openmtp_name}.dmg"
    xcrun stapler validate "$openmtp_dist/${openmtp_name}.dmg"
    openmtp_signing=notarized
  fi
fi
cat > "$openmtp_dist/${openmtp_name}.json" <<JSON
{"format":"openmtp-native","version":"${openmtp_version}","architecture":"${openmtp_arch}","minimumMacOS":"13.0","signing":"${openmtp_signing}","zip":"${openmtp_name}.zip","dmg":"${openmtp_name}.dmg"}
JSON
(cd "$openmtp_dist" && shasum -a 256 "${openmtp_name}.zip" "${openmtp_name}.dmg" > "${openmtp_name}-SHA256.txt")
printf '%s/%s\n' "$openmtp_dist" "$openmtp_name"
