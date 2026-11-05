#!/bin/bash
# Build Swift executables and embed the pinned native Sparkle framework.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/verify-environment.sh
openmtp_arch="${OPENMTP_ARCH:-$(uname -m)}"
case "$openmtp_arch" in
  arm64|x86_64) openmtp_arches=("$openmtp_arch") ;;
  universal) openmtp_arches=(arm64 x86_64) ;;
  *) echo "Unsupported architecture: $openmtp_arch" >&2; exit 1 ;;
esac
openmtp_version="$(tr -d '\n\r' < VERSION)"
openmtp_short_version="${openmtp_version%%-*}"
openmtp_build="${OPENMTP_BUILD_NUMBER:-1}"
[[ "$openmtp_build" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || { echo 'Build number must be numeric.' >&2; exit 1; }
openmtp_app="build/OpenMTP.app"
openmtp_stage="$(mktemp -d build-stage.XXXXXX)"
trap 'rm -rf "$openmtp_stage"' EXIT
mkdir -p "$openmtp_stage/OpenMTP.app/Contents/MacOS" "$openmtp_stage/OpenMTP.app/Contents/Resources"
openmtp_app_bins=()
openmtp_cli_bins=()
for openmtp_slice in "${openmtp_arches[@]}"; do
  swift build --disable-automatic-resolution -c release --arch "$openmtp_slice" --product OpenMTPMac
  swift build --disable-automatic-resolution -c release --arch "$openmtp_slice" --product mtpctl
  openmtp_bin_dir="$(swift build -c release --arch "$openmtp_slice" --show-bin-path)"
  openmtp_app_bins+=("$openmtp_bin_dir/OpenMTPMac")
  openmtp_cli_bins+=("$openmtp_bin_dir/mtpctl")
done
if [[ "$openmtp_arch" == universal ]]; then
  lipo -create "${openmtp_app_bins[@]}" -output "$openmtp_stage/OpenMTP.app/Contents/MacOS/OpenMTP"
  lipo -create "${openmtp_cli_bins[@]}" -output "$openmtp_stage/OpenMTP.app/Contents/MacOS/mtpctl"
else
  cp "${openmtp_app_bins[0]}" "$openmtp_stage/OpenMTP.app/Contents/MacOS/OpenMTP"
  cp "${openmtp_cli_bins[0]}" "$openmtp_stage/OpenMTP.app/Contents/MacOS/mtpctl"
fi
openmtp_sparkle=".build/artifacts/sparkle/Sparkle"
openmtp_framework="$openmtp_stage/OpenMTP.app/Contents/Frameworks/Sparkle.framework"
mkdir -p "$(dirname "$openmtp_framework")"
ditto "$openmtp_sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework" "$openmtp_framework"
cp "$openmtp_sparkle/LICENSE" "$openmtp_stage/OpenMTP.app/Contents/Resources/Sparkle-LICENSE"
cp ../LICENSE NOTICE "$openmtp_stage/OpenMTP.app/Contents/Resources/"
cp Resources/AppIcon.icns "$openmtp_stage/OpenMTP.app/Contents/Resources/"
cat > "$openmtp_stage/OpenMTP.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>OpenMTP</string>
  <key>CFBundleDisplayName</key><string>OpenMTP</string>
  <key>CFBundleIdentifier</key><string>io.ganeshrvel.openmtp</string>
  <key>CFBundleExecutable</key><string>OpenMTP</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${openmtp_short_version}</string>
  <key>CFBundleVersion</key><string>${openmtp_build}</string>
  <key>OpenMTPVersion</key><string>${openmtp_version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSDesktopFolderUsageDescription</key><string>Copy files to and from your Desktop.</string>
  <key>NSDocumentsFolderUsageDescription</key><string>Copy files to and from your Documents.</string>
  <key>NSDownloadsFolderUsageDescription</key><string>Copy files to and from Downloads.</string>
  <key>NSRemovableVolumesUsageDescription</key><string>Copy files to and from removable storage.</string>
  <key>NSHumanReadableCopyright</key><string>OpenMTP contributors. Original OpenMTP by Ganesh Rathinavel.</string>
</dict></plist>
PLIST
openmtp_identity="${OPENMTP_SIGN_IDENTITY:--}"
openmtp_plist="$openmtp_stage/OpenMTP.app/Contents/Info.plist"
# Development builds keep explicit manual update checks. Signed releases enable
# Sparkle only when their matching public key is supplied at build time.
if [[ "$openmtp_identity" != - && -n "${OPENMTP_SPARKLE_PUBLIC_KEY:-}" ]]; then
  [[ "$OPENMTP_SPARKLE_PUBLIC_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo 'Invalid Sparkle public key.' >&2; exit 1; }
  [[ "$openmtp_arch" != universal ]] || { echo 'Build signed update releases per architecture.' >&2; exit 1; }
  /usr/libexec/PlistBuddy -c 'Add OpenMTPAutomaticUpdatesEnabled bool true' "$openmtp_plist"
  /usr/libexec/PlistBuddy -c "Add SUPublicEDKey string $OPENMTP_SPARKLE_PUBLIC_KEY" "$openmtp_plist"
  /usr/libexec/PlistBuddy -c "Add SUFeedURL string https://github.com/aaditagrawal/openmtp/releases/latest/download/appcast-${openmtp_arch}.xml" "$openmtp_plist"
  /usr/libexec/PlistBuddy -c 'Add SUVerifyUpdateBeforeExtraction bool true' "$openmtp_plist"
  /usr/libexec/PlistBuddy -c 'Add SURequireSignedFeed bool true' "$openmtp_plist"
  /usr/libexec/PlistBuddy -c 'Add SUEnableAutomaticChecks bool true' "$openmtp_plist"
fi
plutil -lint "$openmtp_stage/OpenMTP.app/Contents/Info.plist"
openmtp_sign_flags=(--force --sign "$openmtp_identity")
if [[ -n "${OPENMTP_SIGN_KEYCHAIN:-}" ]]; then
  openmtp_sign_flags+=(--keychain "$OPENMTP_SIGN_KEYCHAIN")
fi
if [[ "$openmtp_identity" == - ]]; then
  openmtp_sign_flags+=(--timestamp=none)
else
  openmtp_sign_flags+=(--timestamp --options runtime)
fi
# Sign from the innermost code outwards, preserving each helper's entitlements.
for openmtp_helper in "$openmtp_framework/Versions/B/XPCServices/Downloader.xpc" "$openmtp_framework/Versions/B/XPCServices/Installer.xpc" "$openmtp_framework/Versions/B/Updater.app"; do
  codesign "${openmtp_sign_flags[@]}" --preserve-metadata=entitlements "$openmtp_helper"
done
codesign "${openmtp_sign_flags[@]}" "$openmtp_framework/Versions/B/Autoupdate"
codesign "${openmtp_sign_flags[@]}" "$openmtp_framework"
codesign "${openmtp_sign_flags[@]}" "$openmtp_stage/OpenMTP.app/Contents/MacOS/mtpctl"
codesign "${openmtp_sign_flags[@]}" "$openmtp_stage/OpenMTP.app"
codesign --verify --strict --deep "$openmtp_stage/OpenMTP.app"
for openmtp_slice in "${openmtp_arches[@]}"; do
  lipo "$openmtp_stage/OpenMTP.app/Contents/MacOS/OpenMTP" -verify_arch "$openmtp_slice"
  lipo "$openmtp_stage/OpenMTP.app/Contents/MacOS/mtpctl" -verify_arch "$openmtp_slice"
done
mkdir -p build
rm -rf "$openmtp_app"
mv "$openmtp_stage/OpenMTP.app" "$openmtp_app"
printf '%s\n' "$openmtp_app"
