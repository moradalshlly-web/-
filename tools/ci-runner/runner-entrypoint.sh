#!/usr/bin/env bash
set -euo pipefail
# The initial image build has no assignment. Restart policy must be NEVER;
# the controller redeploys this image with a new JIT identity for every job.
if [[ -z "${RUNNER_JIT_CONFIG:-}" ]]; then
  echo 'Runner image ready; no assignment.'
  exit 0
fi
jit_config="$RUNNER_JIT_CONFIG"
unset RUNNER_JIT_CONFIG
timeout --signal=TERM --kill-after=30 3600 ./run.sh --jitconfig "$jit_config" &
runner_pid=$!
unset jit_config
(
  sleep 300
  if [[ ! -f /tmp/ci-job-started ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
  fi
) &
idle_pid=$!
trap 'kill -TERM "$runner_pid" "$idle_pid" 2>/dev/null || true' TERM INT EXIT
wait "$runner_pid"
