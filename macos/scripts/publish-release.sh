#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/release-policy.sh"
cd "$(dirname "$0")/../.."
openmtp_version="$(tr -d '\n\r' < macos/VERSION)"
openmtp_tag="${1:?Expected release tag}"
[[ "$openmtp_tag" == "v$openmtp_version" ]] || { echo 'Release tag and VERSION differ.' >&2; exit 1; }
for openmtp_arch in arm64 x86_64; do
  openmtp_name="OpenMTP-${openmtp_version}-macos-${openmtp_arch}"
  test -s "dist/${openmtp_name}.zip"
  test -s "dist/${openmtp_name}.dmg"
  openmtp_manifest="dist/${openmtp_name}.json"
  test -s "$openmtp_manifest"
  test "$(plutil -extract format raw -o - "$openmtp_manifest")" = openmtp-native
  test "$(plutil -extract version raw -o - "$openmtp_manifest")" = "$openmtp_version"
  test "$(plutil -extract architecture raw -o - "$openmtp_manifest")" = "$openmtp_arch"
  test "$(plutil -extract minimumMacOS raw -o - "$openmtp_manifest")" = 13.0
  test "$(plutil -extract zip raw -o - "$openmtp_manifest")" = "${openmtp_name}.zip"
  test "$(plutil -extract dmg raw -o - "$openmtp_manifest")" = "${openmtp_name}.dmg"
  if [[ "$openmtp_version" != *-* ]]; then
    test "$(plutil -extract signing raw -o - "$openmtp_manifest")" = notarized
  fi
  (cd dist && shasum -a 256 -c "${openmtp_name}-SHA256.txt")
done
if [[ "$openmtp_version" != *-* ]]; then
  for openmtp_arch in arm64 x86_64; do
    test -s "dist/appcast-${openmtp_arch}.xml"
  done
fi
(cd dist && shasum -a 256 ./*.zip ./*.dmg > CHECKSUMS_SHA256.txt)
openmtp_options=(--repo aaditagrawal/openmtp --verify-tag --title "OpenMTP $openmtp_version" --notes-file macos/RELEASE_NOTES.md --draft --latest=false)
[[ "$openmtp_version" != *-* ]] || openmtp_options+=(--prerelease)
gh release create "$openmtp_tag" "${openmtp_options[@]}"
for openmtp_asset in dist/*.zip dist/*.dmg; do
  gh release upload "$openmtp_tag" "$openmtp_asset#openmtp-native;minimum-macos=13.0" --repo aaditagrawal/openmtp
done
gh release upload "$openmtp_tag" dist/*.json dist/*SHA256.txt --repo aaditagrawal/openmtp
for openmtp_feed in dist/appcast-*.xml; do
  [[ -f "$openmtp_feed" ]] || continue
  gh release upload "$openmtp_tag" "$openmtp_feed" --repo aaditagrawal/openmtp
done
openmtp_latest=true
if [[ "$openmtp_version" == *-* ]]; then
  openmtp_latest=false
else
  openmtp_latest="$(openmtp_may_promote_stable)"
fi
gh release edit "$openmtp_tag" --repo aaditagrawal/openmtp --draft=false "--latest=$openmtp_latest"
