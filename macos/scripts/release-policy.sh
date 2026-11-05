#!/bin/bash

openmtp_minimum_os_is_supported() {
  # Compare every component; 13.0.1 and 13.5 cannot run on macOS 13.0.
  awk -F. 'NF < 1 || NF > 3 { exit 1 }
    { for (i = 1; i <= NF; i++) if ($i !~ /^[0-9]+$/) exit 1
      if ($1 > 13 || ($1 == 13 && ($2 > 0 || $3 > 0))) exit 1
    }' <<< "$1"
}

# Sparkle orders builds by their numeric build number. A maintenance release
# built later must not move the stable feed backwards in semantic version.
openmtp_stable_is_newer() {
  local openmtp_candidate="${1#v}" openmtp_previous="${2#v}"
  local openmtp_numeric='^[0-9]+\.[0-9]+\.[0-9]+$'
  [[ "$openmtp_candidate" =~ $openmtp_numeric && "$openmtp_previous" =~ $openmtp_numeric ]] || {
    echo 'Latest stable release must have a numeric three-part version.' >&2
    return 2
  }
  local openmtp_left openmtp_right openmtp_i
  local -a openmtp_candidate_parts openmtp_previous_parts
  IFS=. read -r -a openmtp_candidate_parts <<< "$openmtp_candidate"
  IFS=. read -r -a openmtp_previous_parts <<< "$openmtp_previous"
  for openmtp_i in 0 1 2; do
    openmtp_left="${openmtp_candidate_parts[$openmtp_i]}"
    openmtp_right="${openmtp_previous_parts[$openmtp_i]}"
    while [[ ${#openmtp_left} -gt 1 && "$openmtp_left" == 0* ]]; do openmtp_left="${openmtp_left#0}"; done
    while [[ ${#openmtp_right} -gt 1 && "$openmtp_right" == 0* ]]; do openmtp_right="${openmtp_right#0}"; done
    if [[ ${#openmtp_left} -gt ${#openmtp_right} ]]; then return 0; fi
    if [[ ${#openmtp_left} -lt ${#openmtp_right} ]]; then return 1; fi
    if [[ "$openmtp_left" > "$openmtp_right" ]]; then return 0; fi
    if [[ "$openmtp_left" < "$openmtp_right" ]]; then return 1; fi
  done
  return 1
}

openmtp_may_promote_stable() {
  local openmtp_response openmtp_status openmtp_previous openmtp_result
  openmtp_response="$(mktemp "${TMPDIR:-/tmp}/openmtp-latest.XXXXXX")"
  if gh api repos/aaditagrawal/openmtp/releases/latest --include > "$openmtp_response"; then
    openmtp_status=200
  else
    openmtp_status="$(awk '/^HTTP\//{code=$2} END{print code}' "$openmtp_response")"
    if [[ "$openmtp_status" == 404 ]]; then
      rm "$openmtp_response"
      printf 'true\n'
      return
    fi
    rm "$openmtp_response"
    echo 'Could not determine the latest stable release; publication stopped.' >&2
    return 1
  fi
  # Headers end at a blank line. Parse the JSON body with the system plist tool.
  openmtp_previous="$(awk 'body{print} /^\r?$/{body=1}' "$openmtp_response" | plutil -extract tag_name raw -o - -)" || {
    rm "$openmtp_response"
    return 1
  }
  rm "$openmtp_response"
  if openmtp_stable_is_newer "$openmtp_version" "$openmtp_previous"; then
    printf 'true\n'
  else
    openmtp_result=$?
    [[ "$openmtp_result" == 1 ]] || return "$openmtp_result"
    printf 'false\n'
  fi
}
