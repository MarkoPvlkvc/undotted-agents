#!/bin/sh
# Fill sensor for autopilot. Reads a background orchestrator's transcript,
# derives its real context-% (from the transcript's own API usage records, with
# a byte-size fallback, or no reading at all for a transcript too tiny to carry
# either), mirrors the reading to a status file (source=usage|estimate|none),
# and emits threshold events. It also spots a usage-limit hit in the
# transcript, waits silently until the reset, then emits LIMIT-RESET, so it
# must run as a background command with no runtime cap.
set -eu

TRANSCRIPT="${1:?transcript path}"
WINDOW="${2:?window tokens}"
SOFT="${3:?soft pct}"
HARD="${4:?hard pct}"
STATUS="${5:?status file}"
MODE="${6:-loop}"

CHARS_PER_TOKEN="${CHARS_PER_TOKEN:-4}"
POLL_SECS="${POLL_SECS:-20}"

case "$WINDOW" in
  ''|*[!0-9]*) printf '%s\n' "DEGRADED bad-window"; exit 3 ;;
esac
[ "$WINDOW" -gt 0 ] || { printf '%s\n' "DEGRADED bad-window"; exit 3; }

# Runs in the MAIN shell (never a subshell) so its emit reaches real stdout and
# its exit ends the script.
check_transcript() {
  if [ ! -r "$TRANSCRIPT" ]; then
    printf '%s\n' "DEGRADED transcript-missing"
    exit 3
  fi
}

# Prints the real context-token count from the LAST transcript line carrying a
# usage object (input + cache_creation + cache_read; output excluded), or empty
# if none is parseable. The leading quote in each pattern prevents matching the
# `input_tokens` substring inside the cache_* field names.
parse_usage_tokens() {
  awk '
    /"usage"/ {
      i=0; cc=0; cr=0
      if (match($0, /"input_tokens":[0-9]+/))                i=substr($0,RSTART+15,RLENGTH-15)
      if (match($0, /"cache_creation_input_tokens":[0-9]+/)) cc=substr($0,RSTART+30,RLENGTH-30)
      if (match($0, /"cache_read_input_tokens":[0-9]+/))     cr=substr($0,RSTART+26,RLENGTH-26)
      last=i+cc+cr; found=1
    }
    END { if (found) print last+0 }
  ' "$TRANSCRIPT"
}

# Prints "<resetsAt epoch> <window>" from the last usage-limit record in the
# transcript, or nothing when the orchestrator never hit one.
parse_limit() {
  awk '
    /"error":"rate_limit"/ {
      r=""; w="unknown"
      if (match($0, /"resetsAt":[0-9]+/))         r=substr($0,RSTART+11,RLENGTH-11)
      if (match($0, /"rateLimitType":"[a-z_]+"/)) w=substr($0,RSTART+17,RLENGTH-18)
      if (r != "") last=r " " w
    }
    END { if (last != "") print last }
  ' "$TRANSCRIPT"
}

# Waits on the wall clock (laptop sleep does not stretch it) until 2 minutes
# past the reset, printing nothing meanwhile: a line during the limit would
# wake the supervisor into its own rejected turn. A reset more than 24h out
# ends the wait at once.
wait_for_reset() {
  reset=$1; window=$2
  printf 'limit=%s window=%s\n' "$reset" "$window" > "$STATUS"
  if [ $((reset - $(date +%s))) -gt 86400 ]; then
    printf 'LIMIT-FAR %s %s\n' "$window" "$reset"
    exit 0
  fi
  while [ "$(date +%s)" -lt $((reset + 120)) ]; do sleep 60; done
  printf 'LIMIT-RESET %s\n' "$window"
  exit 0
}

# Echoes only the pct (safe to capture); mirrors the full reading + source to the
# status file as a side effect.
compute_pct() {
  tokens=$(parse_usage_tokens)
  if [ -n "$tokens" ]; then
    source=usage
  else
    bytes=$(wc -c < "$TRANSCRIPT" | tr -d ' ')
    if [ "$bytes" -gt 2000 ]; then
      tokens=$((bytes / CHARS_PER_TOKEN)); source=estimate
    else
      tokens=0; source=none
    fi
  fi
  pct=$((tokens * 100 / WINDOW))
  printf 'pct=%s tokens=%s window=%s source=%s\n' "$pct" "$tokens" "$WINDOW" "$source" > "$STATUS"
  printf '%s' "$pct"
}

if [ "$MODE" = "--once" ]; then
  check_transcript
  pct=$(compute_pct)
  if [ "$pct" -ge "$HARD" ]; then printf 'HARD %s\n' "$pct"
  elif [ "$pct" -ge "$SOFT" ]; then printf 'SOFT %s\n' "$pct"
  fi
  exit 0
fi

soft_fired=0
while :; do
  check_transcript
  limit=$(parse_limit)
  [ -n "$limit" ] && wait_for_reset $limit
  pct=$(compute_pct)
  if [ "$pct" -ge "$HARD" ]; then
    printf 'HARD %s\n' "$pct"
    exit 0
  fi
  if [ "$pct" -ge "$SOFT" ] && [ "$soft_fired" -eq 0 ]; then
    printf 'SOFT %s\n' "$pct"
    soft_fired=1
  fi
  sleep "$POLL_SECS"
done
