#!/usr/bin/env bash
# run-commercial-resources-codex.sh
# Loop autónomo por cortes SDD de la feature 011 — Recursos comerciales.
# Cada corte usa una sesión NUEVA de codex exec. Sin resume/continuidad.
# Ejecutar SOLO desde Bash/WSL externo, en la raíz; nunca dentro de Codex.
# Primera tanda: START_CUT=1 END_CUT=3 bash scripts/ai/run-commercial-resources-codex.sh
# Después: START_CUT=4 END_CUT=4 bash scripts/ai/run-commercial-resources-codex.sh
# Fallo: conservar cambios, revisar log/status y terminar SOLO ese corte en una
# sesión nueva antes de reanudar N+1. Nunca reset/checkout/clean automático.
# START_CUT=1 END_CUT=4 CUT_TIMEOUT=90m HEARTBEAT_SECONDS=25 (defaults).
set -Eeuo pipefail

readonly REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" || "${REPO_ROOT}" != "$(pwd)" ]]; then
  echo "ERROR: ejecutar desde la raíz del repositorio." >&2
  exit 64
fi

if [[ -n "${CODEX_THREAD_ID:-}" || -n "${CODEX_SESSION_ID:-}" ]]; then
  echo "ERROR: ejecutar desde una terminal Bash/WSL fuera de la sesión de Codex." >&2
  exit 64
fi

for bin in codex git tee timeout cat date sleep find tail wc tr basename mkdir sort head cut; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: '${bin}' no está disponible en PATH." >&2
    exit 65
  fi
done

readonly TASKS_DIR="${REPO_ROOT}/.ai/tasks/commercial-resources"
readonly LOGS_DIR="${REPO_ROOT}/.ai/logs/commercial-resources"
readonly TASK_PLAN=(
  "1:01-cut1-foundation.md"
  "2:02-cut2-resources-ui.md"
  "3:03-cut3-native-demos.md"
  "4:04-cut4-payment-instructions.md"
)
readonly TOTAL_CUTS="${#TASK_PLAN[@]}"

for entry in "${TASK_PLAN[@]}"; do
  task_file="${entry#*:}"
  [[ -f "${TASKS_DIR}/${task_file}" ]] || { echo "ERROR: falta ${TASKS_DIR}/${task_file}" >&2; exit 67; }
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree sucio antes de iniciar." >&2
  echo "Si es trabajo parcial de un corte fallido, NO lo descartes:" >&2
  echo "inspecciona 'git status' y 'git log --oneline -5', y reanuda con START_CUT=N." >&2
  git status --short >&2
  exit 68
fi

START_CUT="${START_CUT:-1}"
END_CUT="${END_CUT:-4}"
if ! [[ "${START_CUT}" =~ ^[1-4]$ && "${END_CUT}" =~ ^[1-4]$ ]] || (( START_CUT > END_CUT )); then
  echo "ERROR: exigir 1 <= START_CUT <= END_CUT <= ${TOTAL_CUTS}." >&2
  exit 71
fi
readonly START_CUT END_CUT
readonly INITIAL_HEAD="$(git rev-parse HEAD)"
readonly CUT_TIMEOUT="${CUT_TIMEOUT:-90m}"
readonly HEARTBEAT_SECONDS="${HEARTBEAT_SECONDS:-25}"
if ! [[ "${CUT_TIMEOUT}" =~ ^[1-9][0-9]*([.][0-9]+)?[smhd]?$ ]]; then
  echo "ERROR: CUT_TIMEOUT debe ser una duración positiva GNU timeout, p. ej. 90m." >&2
  exit 71
fi
if ! [[ "${HEARTBEAT_SECONDS}" =~ ^[1-9][0-9]{0,3}$ ]]; then
  echo "ERROR: HEARTBEAT_SECONDS debe ser entero positivo (default 25)." >&2
  exit 71
fi
if [[ "$(timeout --version)" != *"GNU coreutils"* ]]; then
  echo "ERROR: se requiere GNU timeout." >&2
  exit 65
fi

# Compatibilidad con versiones instaladas: preferir el flag solicitado;
# versiones nuevas ofrecen auto-review con el mismo sandbox workspace-write.
CODEX_HELP="$(codex exec --help 2>&1)"
readonly CODEX_HELP
if [[ "${CODEX_HELP}" == *"--full-auto"* ]]; then
  readonly CODEX_AUTO_FLAG="--full-auto"
elif [[ "${CODEX_HELP}" == *"--approve-for-me"* ]]; then
  readonly CODEX_AUTO_FLAG="--approve-for-me"
else
  echo "ERROR: Codex no ofrece --full-auto ni --approve-for-me; actualizar CLI." >&2
  exit 65
fi

mkdir -p "${LOGS_DIR}"
# Los logs deben permanecer ignorados para no ensuciar el árbol por sí mismos.
if ! git check-ignore -q "${LOGS_DIR}/preflight.log"; then
  echo "ERROR: los logs .ai/logs/commercial-resources/*.log deben estar ignorados." >&2
  exit 65
fi

heartbeat_pid=""
stop_heartbeat() {
  if [[ -n "${heartbeat_pid}" ]]; then
    kill "${heartbeat_pid}" 2>/dev/null || true
    wait "${heartbeat_pid}" 2>/dev/null || true
    heartbeat_pid=""
  fi
}
trap stop_heartbeat EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

heartbeat() {
  local cut="$1"
  local started="$2"
  local log_file="$3"
  local sleep_pid=""
  trap '[[ -z "${sleep_pid}" ]] || kill "${sleep_pid}" 2>/dev/null || true; exit 0' TERM INT
  while true; do
    sleep "${HEARTBEAT_SECONDS}" &
    sleep_pid=$!
    wait "${sleep_pid}" || return 0
    sleep_pid=""
    local elapsed changed recent head
    elapsed=$(( $(date +%s) - started ))
    changed="$(git status --porcelain | wc -l | tr -d ' ')"
    recent="$(find src tests specs docs drizzle scripts .ai/tasks -type f -mmin -2 -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2- || true)"
    head="$(git rev-parse --short=9 HEAD)"
    {
      echo "[$(date +%H:%M:%S)] CUT ${cut}/${TOTAL_CUTS} sigue trabajando | ${elapsed}s | cambios=${changed} | HEAD=${head}"
      [[ -z "${recent}" ]] || echo "  actividad reciente: ${recent}"
    } | tee -a "${log_file}"
  done
}

run_cut() {
  local index="$1"
  local task_file="$2"
  local log_file="${LOGS_DIR}/cut-${index}-$(basename "${task_file}" .md)-$(date +%Y%m%dT%H%M%S)-$$.log"
  local previous_head current_head started exit_code
  local -a pipeline_status
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "ERROR: árbol sucio antes del corte ${index}; conservar cambios." >&2
    git status --short >&2
    exit 68
  fi
  previous_head="$(git rev-parse HEAD)"

  {
    echo "============================================================"
    echo "CUT ${index}/${TOTAL_CUTS} — $(date +%Y-%m-%dT%H:%M:%S%z)"
    echo "task: ${TASKS_DIR}/${task_file}"
    echo "log:  ${log_file}"
    echo "HEAD: ${previous_head}"
    echo "============================================================"
  } | tee "${log_file}"

  started="$(date +%s)"
  heartbeat "${index}" "${started}" "${log_file}" &
  heartbeat_pid=$!

  set +e
  (
    cd "${REPO_ROOT}" || exit 64
    timeout --kill-after=30s "${CUT_TIMEOUT}" \
      codex exec "${CODEX_AUTO_FLAG}" "$(cat "${TASKS_DIR}/${task_file}")" < /dev/null
  ) 2>&1 | tee -a "${log_file}"
  pipeline_status=("${PIPESTATUS[@]}")
  set -e
  exit_code="${pipeline_status[0]}"
  # tee fallando también detiene el loop aunque Codex termine con éxito.
  if (( exit_code == 0 && pipeline_status[1] != 0 )); then
    exit_code="${pipeline_status[1]}"
  fi
  stop_heartbeat

  if [[ ${exit_code} -ne 0 ]]; then
    echo "FAILED CUT ${index} (exit=${exit_code})"
    echo "Pipeline detenido. Revisa ${log_file} y git status."
    echo "NO resetees ni descartes cambios: relanza este mismo corte en una sesión nueva."
    exit "${exit_code}"
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "FAILED CUT ${index} — working tree sucio:"
    git status --short
    echo "NO resetees ni descartes cambios: relanza este mismo corte en una sesión nueva."
    exit 69
  fi

  current_head="$(git rev-parse HEAD)"
  if [[ "${current_head}" == "${previous_head}" ]]; then
    echo "FAILED CUT ${index} — no se generó commit nuevo."
    exit 70
  fi

  if [[ "$(git show -s --format=%P "${current_head}")" != "${previous_head}" ]]; then
    echo "FAILED CUT ${index} — se exige exactamente UN commit atómico descendiente de HEAD inicial."
    echo "Conservar commits/cambios e inspeccionar el historial; no recuperación automática."
    exit 70
  fi

  echo "SUCCESS CUT ${index}/${TOTAL_CUTS} — ${previous_head:0:9}..${current_head:0:9}"
}

echo "Runner Commercial Resources (feature 011)"
echo "Inicial:   ${INITIAL_HEAD:0:9}"
echo "Cortes:    ${TOTAL_CUTS}"
echo "START_CUT: ${START_CUT}"
echo "END_CUT:   ${END_CUT}"
echo "Timeout:   ${CUT_TIMEOUT}"
echo "Codex:     exec ${CODEX_AUTO_FLAG} (sesión nueva por corte)"
echo "Logs:      ${LOGS_DIR}"
echo

for entry in "${TASK_PLAN[@]}"; do
  index="${entry%%:*}"
  task_file="${entry#*:}"
  if (( index < START_CUT )); then
    echo "SKIP CUT ${index}/${TOTAL_CUTS} (${task_file})"
    continue
  fi
  if (( index > END_CUT )); then
    break
  fi
  run_cut "${index}" "${task_file}"
done

readonly FINAL_HEAD="$(git rev-parse HEAD)"
echo
echo "============================================================"
echo "RANGO ${START_CUT}–${END_CUT} COMPLETADO (no implica READY E2E)"
echo "Rango: ${INITIAL_HEAD:0:9}..${FINAL_HEAD:0:9}"
git log --oneline "${INITIAL_HEAD}..${FINAL_HEAD}"
echo "============================================================"
