#!/bin/bash
# Exercise publication through a mocked GitHub CLI; never contact GitHub.
set -euo pipefail
openmtp_scripts="$(cd "$(dirname "$0")" && pwd)"
source "$openmtp_scripts/release-policy.sh"
for openmtp_minimum in 12.9.9 13 13.0 13.0.0; do
  openmtp_minimum_os_is_supported "$openmtp_minimum"
done
for openmtp_minimum in 13.0.1 13.5 14.0 invalid 13.0.0.1; do
  if openmtp_minimum_os_is_supported "$openmtp_minimum"; then
    echo "Invalid deployment target accepted: $openmtp_minimum" >&2
    exit 1
  fi
done
openmtp_test="$(mktemp -d "${TMPDIR:-/tmp}/openmtp-release-policy.XXXXXX")"
trap 'rm -rf "$openmtp_test"' EXIT
mkdir -p "$openmtp_test/macos/scripts" "$openmtp_test/dist" "$openmtp_test/bin"
cp "$openmtp_scripts/publish-release.sh" "$openmtp_scripts/release-policy.sh" "$openmtp_test/macos/scripts/"
printf '# Release fixture\n' > "$openmtp_test/macos/RELEASE_NOTES.md"
cat > "$openmtp_test/bin/gh" <<'MOCK'
#!/bin/bash
set -eu
if [[ "$1" == api ]]; then
  case "$MOCK_LATEST" in
    missing) printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'; exit 1 ;;
    forbidden) printf 'HTTP/2.0 403 Forbidden\r\n\r\n{"message":"Forbidden"}\n'; exit 1 ;;
    *) printf 'HTTP/2.0 200 OK\r\ncontent-type: application/json\r\n\r\n{"tag_name":"%s"}\n' "$MOCK_LATEST" ;;
  esac
else
  printf '%s\n' "$*" >> "$MOCK_GH_LOG"
fi
MOCK
chmod +x "$openmtp_test/bin/gh"
export PATH="$openmtp_test/bin:$PATH"
export MOCK_GH_LOG="$openmtp_test/gh.log"
for openmtp_case in '4.0.2 v4.1.0 false' '4.1.1 v4.1.0 true' '4.10.0 v4.9.9 true' '4.1.0 v4.1.0 false' '4.0.0 missing true' '4.2.0-beta.1 v4.1.0 false'; do
  read -r openmtp_version MOCK_LATEST openmtp_expected <<< "$openmtp_case"
  export MOCK_LATEST
  printf '%s\n' "$openmtp_version" > "$openmtp_test/macos/VERSION"
  : > "$MOCK_GH_LOG"
  for openmtp_arch in arm64 x86_64; do
    openmtp_name="OpenMTP-${openmtp_version}-macos-${openmtp_arch}"
    printf 'test archive\n' > "$openmtp_test/dist/${openmtp_name}.zip"
    printf 'test disk\n' > "$openmtp_test/dist/${openmtp_name}.dmg"
    printf '{"format":"openmtp-native","version":"%s","architecture":"%s","minimumMacOS":"13.0","signing":"notarized","zip":"%s.zip","dmg":"%s.dmg"}\n' "$openmtp_version" "$openmtp_arch" "$openmtp_name" "$openmtp_name" > "$openmtp_test/dist/${openmtp_name}.json"
    printf '<rss/>\n' > "$openmtp_test/dist/appcast-${openmtp_arch}.xml"
    (cd "$openmtp_test/dist" && shasum -a 256 "${openmtp_name}.zip" "${openmtp_name}.dmg" > "${openmtp_name}-SHA256.txt")
  done
  bash "$openmtp_test/macos/scripts/publish-release.sh" "v$openmtp_version" > "$openmtp_test/output.log"
  tail -1 "$MOCK_GH_LOG" | grep -q -- "--latest=$openmtp_expected"
done
export MOCK_LATEST=forbidden
if bash "$openmtp_test/macos/scripts/publish-release.sh" 'v4.2.0-beta.1' > /dev/null 2>&1; then
  : # Explicit beta publication must not require a latest-stable lookup.
else
  exit 1
fi
# Reuse a stable fixture to ensure an API failure cannot publish a stable feed.
printf '4.0.0\n' > "$openmtp_test/macos/VERSION"
: > "$MOCK_GH_LOG"
if bash "$openmtp_test/macos/scripts/publish-release.sh" v4.0.0 > /dev/null 2>&1; then
  echo 'Stable publication ignored a latest-release API failure.' >&2
  exit 1
fi
if grep -q 'release edit' "$MOCK_GH_LOG"; then
  echo 'Stable release was made visible despite an API failure.' >&2
  exit 1
fi
printf 'Native release promotion policy passed.\n'
