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
  for openmtp_slice in $(lipo -archs "$openmtp_app/Contents/MacOS/$openmtp_binary"); do
    openmtp_build_info="$(vtool -arch "$openmtp_slice" -show-build "$openmtp_app/Contents/MacOS/$openmtp_binary")"
    openmtp_minimum="$(awk '/^[[:space:]]*minos /{print $2}' <<< "$openmtp_build_info")"
    test -n "$openmtp_minimum"
    openmtp_minimum_os_is_supported "$openmtp_minimum"
    openmtp_linked_sdk="$(awk '/^[[:space:]]*sdk /{print $2}' <<< "$openmtp_build_info")"
    if [[ ! "$openmtp_linked_sdk" =~ ^[0-9]+(\.[0-9]+){1,2}$ ]] || (( ${openmtp_linked_sdk%%.*} < 26 )); then
      echo "$openmtp_binary ($openmtp_slice) must link macOS SDK 26+; found '$openmtp_linked_sdk'." >&2
      exit 1
    fi
  done
done
test -s "../dist/${openmtp_name}.zip"
test -s "../dist/${openmtp_name}.dmg"
test -s "../dist/${openmtp_name}.json"
(cd ../dist && shasum -a 256 -c "${openmtp_name}-SHA256.txt")
unzip -t "../dist/${openmtp_name}.zip"
hdiutil verify "../dist/${openmtp_name}.dmg"
