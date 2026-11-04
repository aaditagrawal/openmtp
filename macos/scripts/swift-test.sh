#!/bin/sh
# swift test with Command Line Tools only (no Xcode): CLT ships Testing.framework and the
# TestingMacros plugin, but SwiftPM looks for them under a path CLT does not use.
set -eu
cd "$(dirname "$0")/.."
DEV="$(xcode-select -p)"
if [ -d "$DEV/Library/Developer/Frameworks/Testing.framework" ]; then
  F="$DEV/Library/Developer/Frameworks"
  exec swift test \
    -Xswiftc -plugin-path -Xswiftc "$DEV/usr/lib/swift/host/plugins/testing" \
    -Xswiftc -F -Xswiftc "$F" -Xlinker -F -Xlinker "$F" \
    -Xlinker -rpath -Xlinker "$F" -Xlinker -rpath -Xlinker "$DEV/Library/Developer/usr/lib" "$@"
fi
exec swift test "$@"
