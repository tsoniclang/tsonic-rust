#!/usr/bin/env bash
set -euo pipefail

test_concurrency="${TSONIC_RUST_TEST_CONCURRENCY:-2}"
heap_megabytes="${TSONIC_RUST_TEST_HEAP_MB:-1536}"
memory_max="${TSONIC_RUST_TEST_MEMORY_MAX:-8G}"
tasks_max="${TSONIC_RUST_TEST_TASKS_MAX:-256}"
timeout_seconds="${TSONIC_RUST_TEST_TIMEOUT_SECONDS:-3600}"
heartbeat_seconds="${TSONIC_RUST_TEST_HEARTBEAT_SECONDS:-180}"
failure_excerpt_bytes="${TSONIC_RUST_TEST_FAILURE_EXCERPT_BYTES:-16384}"
log_size_max_bytes="${TSONIC_RUST_TEST_LOG_SIZE_MAX_BYTES:-67108864}"

if ! [[ "${test_concurrency}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'TSONIC_RUST_TEST_CONCURRENCY must be a positive integer.\n' >&2
  exit 2
fi

if ! [[ "${heap_megabytes}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'TSONIC_RUST_TEST_HEAP_MB must be a positive integer.\n' >&2
  exit 2
fi

if ! [[ "${tasks_max}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'TSONIC_RUST_TEST_TASKS_MAX must be a positive integer.\n' >&2
  exit 2
fi

if ! [[ "${timeout_seconds}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'TSONIC_RUST_TEST_TIMEOUT_SECONDS must be a positive integer.\n' >&2
  exit 2
fi

if ! [[ "${heartbeat_seconds}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'TSONIC_RUST_TEST_HEARTBEAT_SECONDS must be a positive integer.\n' >&2
  exit 2
fi

if ! [[ "${failure_excerpt_bytes}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'TSONIC_RUST_TEST_FAILURE_EXCERPT_BYTES must be a positive integer.\n' >&2
  exit 2
fi

if ! [[ "${log_size_max_bytes}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'TSONIC_RUST_TEST_LOG_SIZE_MAX_BYTES must be a positive integer.\n' >&2
  exit 2
fi

for required_command in node systemd-run systemctl tail timeout; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    printf 'Required bounded-test command is unavailable: %s\n' "${required_command}" >&2
    exit 2
  fi
done

export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--max-old-space-size=${heap_megabytes}"

if (( $# == 0 )); then
  test_arguments=(test/*.test.mjs test/architecture/*.test.mjs)
else
  test_arguments=("$@")
fi

mkdir -p .temp/test-runs
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
unit="tsonic-rust-tests-${run_id}.scope"
log_file=".temp/test-runs/${run_id}.log"
memory_events="/sys/fs/cgroup/user.slice/user-$(id -u).slice/memory.events"

read_oom_kill_count() {
  if [[ ! -r "${memory_events}" ]]; then
    printf 'unavailable\n'
    return
  fi
  awk '$1 == "oom_kill" { print $2 }' "${memory_events}"
}

oom_kill_before="$(read_oom_kill_count)"
start_epoch="$(date +%s)"
printf 'Tsonic Rust bounded test run\n'
printf '  unit: %s\n' "${unit}"
printf '  log: %s\n' "${log_file}"
printf '  workers: %s\n' "${test_concurrency}"
printf '  heap per worker: %s MiB\n' "${heap_megabytes}"
printf '  process-group memory ceiling: %s\n' "${memory_max}"
printf '  process-group swap ceiling: 0\n'
printf '  process-group task ceiling: %s\n' "${tasks_max}"
printf '  hard timeout: %s seconds\n' "${timeout_seconds}"
printf '  heartbeat: %s seconds\n' "${heartbeat_seconds}"
printf '  live test output: log-only; failure excerpt capped at %s bytes\n' "${failure_excerpt_bytes}"
printf '  complete-log size ceiling: %s bytes\n' "${log_size_max_bytes}"
printf '  user-slice oom_kill before: %s\n' "${oom_kill_before}"

set +e
(
  systemd-run \
    --user \
    --scope \
    --quiet \
    --unit="${unit%.scope}" \
    --property="MemoryMax=${memory_max}" \
    --property="MemorySwapMax=0" \
    --property="TasksMax=${tasks_max}" \
    timeout \
      --signal=TERM \
      --kill-after=30s \
      "${timeout_seconds}s" \
      bash \
        scripts/test-worker.sh \
        "${test_concurrency}" \
        "${test_arguments[@]}" \
    >"${log_file}" 2>&1
) &
test_runner_pid=$!

heartbeat_pid=""
log_guard_pid=""
stop_bounded_test_scope() {
  if [[ -n "${heartbeat_pid}" ]]; then
    kill "${heartbeat_pid}" 2>/dev/null || true
  fi
  if [[ -n "${log_guard_pid}" ]]; then
    kill "${log_guard_pid}" 2>/dev/null || true
  fi
  if kill -0 "${test_runner_pid}" 2>/dev/null; then
    systemctl --user stop "${unit}" --no-block 2>/dev/null || true
    kill "${test_runner_pid}" 2>/dev/null || true
  fi
}
trap stop_bounded_test_scope EXIT HUP INT TERM

(
  while kill -0 "${test_runner_pid}" 2>/dev/null; do
    sleep "${heartbeat_seconds}"
    if ! kill -0 "${test_runner_pid}" 2>/dev/null; then
      break
    fi
    elapsed_seconds=$(( $(date +%s) - start_epoch ))
    printf '[heartbeat] %s remains active; elapsed=%ss\n' "${unit}" "${elapsed_seconds}"
    systemctl --user show "${unit}" \
      --property=MemoryCurrent \
      --property=MemoryPeak \
      --property=TasksCurrent \
      --no-pager 2>/dev/null || true
  done
) &
heartbeat_pid=$!

(
  while kill -0 "${test_runner_pid}" 2>/dev/null; do
    sleep 1
    log_bytes="$(wc -c <"${log_file}")"
    if (( log_bytes > log_size_max_bytes )); then
      systemctl --user stop "${unit}" --no-block 2>/dev/null || true
      kill "${test_runner_pid}" 2>/dev/null || true
      break
    fi
  done
) &
log_guard_pid=$!

wait "${test_runner_pid}"
test_status=$?
kill "${heartbeat_pid}" 2>/dev/null || true
wait "${heartbeat_pid}" 2>/dev/null || true
heartbeat_pid=""
kill "${log_guard_pid}" 2>/dev/null || true
wait "${log_guard_pid}" 2>/dev/null || true
log_guard_pid=""
trap - EXIT HUP INT TERM
set -e

oom_kill_after="$(read_oom_kill_count)"
scope_result="$(systemctl --user show "${unit}" --property=Result --value --no-pager 2>/dev/null || true)"
printf '  exit status: %s\n' "${test_status}"
printf '  scope result: %s\n' "${scope_result:-unavailable}"
printf '  user-slice oom_kill after: %s\n' "${oom_kill_after}"
printf '  complete log: %s (%s bytes)\n' "${log_file}" "$(wc -c <"${log_file}")"

log_size_after="$(wc -c <"${log_file}")"
if (( log_size_after > log_size_max_bytes )); then
  printf 'Bounded test log exceeded its %s-byte ceiling; inspect %s.\n' \
    "${log_size_max_bytes}" \
    "${log_file}" >&2
  exit 153
fi

if (( test_status != 0 )); then
  printf '\nLast %s bytes of failed run (complete output remains in %s):\n' \
    "${failure_excerpt_bytes}" \
    "${log_file}" >&2
  tail -c "${failure_excerpt_bytes}" "${log_file}" >&2
  printf '\n' >&2
fi

if [[ "${scope_result}" == "oom-kill" ]]; then
  printf 'Bounded test scope exhausted its memory ceiling; inspect %s.\n' "${log_file}" >&2
  exit 137
fi

if [[ "${oom_kill_before}" != "unavailable" && "${oom_kill_after}" != "unavailable" &&
  "${oom_kill_after}" -gt "${oom_kill_before}" ]]; then
  printf 'System OOM kill count increased during the test run; inspect %s.\n' "${log_file}" >&2
  exit 137
fi

exit "${test_status}"
