#!/bin/sh
# Builds OpenMTP Native.app (release, arm64) with an ad-hoc signature. No Xcode required.
set -eu
cd "$(dirname "$0")/.."
swift build -c release --product OpenMTPMac
BIN="$(swift build -c release --show-bin-path)/OpenMTPMac"
APP="build/OpenMTP Native.app"
VERSION="$(git describe --tags --always 2>/dev/null || echo 0.0.0)"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/OpenMTP Native"
cp ../LICENSE "$APP/Contents/Resources/LICENSE"
cp NOTICE "$APP/Contents/Resources/NOTICE"
[ -f ../app/app.icns ] && cp ../app/app.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>OpenMTP Native</string>
  <key>CFBundleDisplayName</key><string>OpenMTP Native</string>
  <key>CFBundleIdentifier</key><string>com.aaditagrawal.openmtp.native</string>
  <key>CFBundleExecutable</key><string>OpenMTP Native</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --strict "$APP"
du -sh "$APP"
echo "$APP"
