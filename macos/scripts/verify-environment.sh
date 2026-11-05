#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'OpenMTP requires a Mac with Xcode 26+ or the matching Command Line Tools.' >&2
  exit 1
fi
openmtp_sdk="$(xcrun --sdk macosx --show-sdk-version)"
openmtp_sdk_major="${openmtp_sdk%%.*}"
if (( openmtp_sdk_major < 26 )); then
  echo "macOS SDK 26+ is required to compile Liquid Glass; selected SDK is $openmtp_sdk." >&2
  exit 1
fi
swift --version
test -f Package.resolved
printf 'macOS SDK %s; runtime deployment target 13.0\n' "$openmtp_sdk"
for openmtp_script in scripts/*.sh; do
  bash -n "$openmtp_script"
done
openmtp_version="$(tr -d '\n\r' < VERSION)"
if [[ ! "$openmtp_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
  echo 'macos/VERSION must contain a release SemVer.' >&2
  exit 1
fi
