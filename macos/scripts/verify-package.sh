#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/release-policy.sh"
cd "$(dirname "$0")/.."
openmtp_app="build/OpenMTP.app"
openmtp_arch="${OPENMTP_ARCH:-$(uname -m)}"
openmtp_version="$(tr -d '\n\r' < VERSION)"
openmtp_name="OpenMTP-${openmtp_version}-macos-${openmtp_arch}"
codesign --verify --strict --deep "$openmtp_app"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$openmtp_app/Contents/Info.plist")" = io.ganeshrvel.openmtp
test "$(/usr/libexec/PlistBuddy -c 'Print OpenMTPVersion' "$openmtp_app/Contents/Info.plist")" = "$openmtp_version"
test -f "$openmtp_app/Contents/Resources/LICENSE"
test -f "$openmtp_app/Contents/Resources/NOTICE"
test -f "$openmtp_app/Contents/Resources/Sparkle-LICENSE"
test -d "$openmtp_app/Contents/Frameworks/Sparkle.framework"
test -x "$openmtp_app/Contents/MacOS/mtpctl"
if find "$openmtp_app" \( -name '*.asar' -o -name 'Electron Framework.framework' -o -name 'kalam.dylib' -o -name 'libusb.dylib' -o -name node_modules \) -print -quit | grep -q .; then
  echo 'Legacy runtime found in the native app.' >&2
  exit 1
fi
for openmtp_binary in OpenMTP mtpctl; do
  otool -L "$openmtp_app/Contents/MacOS/$openmtp_binary"
  if otool -L "$openmtp_app/Contents/MacOS/$openmtp_binary" | grep -Eiq 'libusb|kalam|Electron|/opt/homebrew/|/usr/local/'; then
    echo 'Native executable depends on a legacy or unbundled runtime.' >&2
    exit 1
  fi
  openmtp_minimum="$(vtool -show-build "$openmtp_app/Contents/MacOS/$openmtp_binary" | awk '/minos/{print $2}')"
  test -n "$openmtp_minimum"
  while IFS= read -r openmtp_slice_minimum; do
    openmtp_minimum_os_is_supported "$openmtp_slice_minimum"
  done <<< "$openmtp_minimum"
done
test -s "../dist/${openmtp_name}.zip"
test -s "../dist/${openmtp_name}.dmg"
test -s "../dist/${openmtp_name}.json"
(cd ../dist && shasum -a 256 -c "${openmtp_name}-SHA256.txt")
unzip -t "../dist/${openmtp_name}.zip"
hdiutil verify "../dist/${openmtp_name}.dmg"
