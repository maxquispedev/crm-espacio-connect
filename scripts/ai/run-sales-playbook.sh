#!/usr/bin/env bash
# run-sales-playbook.sh
# Loop autónomo por cortes SDD de la feature 008 — Sales Playbook.
# Cada corte usa una sesión NUEVA de `mcode exec` (sin --continue).
#
# Reanudar: START_CUT=4 ./scripts/ai/run-sales-playbook.sh
#
# Variables configurables:
#   START_CUT=n           # reanuda desde el corte N (default: 1)
#   CUT_TIMEOUT=90m       # timeout por corte (default: 60m)
#   CUT_PERMISSION=full   # permission mode de mcode (default: full)
#   HEARTBEAT_SECONDS=25  # intervalo de heartbeat (default: 25)
set -Eeuo pipefail

readonly REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" || "${REPO_ROOT}" != "$(pwd)" ]]; then
  echo "ERROR: ejecutar desde la raíz del repositorio." >&2
  exit 64
fi

for bin in mcode git tee; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: '${bin}' no está disponible en PATH." >&2
    exit 65
  fi
done

readonly TASKS_DIR="${REPO_ROOT}/.ai/tasks/sales-playbook"
readonly LOGS_DIR="${REPO_ROOT}/.ai/logs/sales-playbook"
readonly TASK_PLAN=(
  "1:01-cut1-model-and-bootstrap.md"
  "2:02-cut2-api-versioning.md"
  "3:03-cut3-runtime.md"
  "4:04-cut4-ui-playbook.md"
  "5:05-cut5-jev-editor.md"
  "6:06-cut6-lab-commercial.md"
  "7:07-cut7-cases-bootstrap-audit.md"
)
readonly TOTAL_CUTS="${#TASK_PLAN[@]}"

for entry in "${TASK_PLAN[@]}"; do
  task_file="${entry#*:}"
  [[ -f "${TASKS_DIR}/${task_file}" ]] || { echo "ERROR: falta ${TASKS_DIR}/${task_file}" >&2; exit 67; }
done

mkdir -p "${LOGS_DIR}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree sucio antes de iniciar." >&2
  git status --short >&2
  exit 68
fi

START_CUT="${START_CUT:-1}"
if ! [[ "${START_CUT}" =~ ^[0-9]+$ ]] || (( START_CUT < 1 || START_CUT > TOTAL_CUTS )); then
  echo "ERROR: START_CUT debe estar entre 1 y ${TOTAL_CUTS}." >&2
  exit 71
fi

readonly INITIAL_HEAD="$(git rev-parse HEAD)"
readonly CUT_TIMEOUT="${CUT_TIMEOUT:-60m}"
readonly CUT_PERMISSION="${CUT_PERMISSION:-full}"
readonly HEARTBEAT_SECONDS="${HEARTBEAT_SECONDS:-25}"

heartbeat() {
  local cut="$1"
  local started="$2"
  while true; do
    sleep "${HEARTBEAT_SECONDS}" || return 0
    local elapsed changed recent head
    elapsed=$(( $(date +%s) - started ))
    changed="$(git status --porcelain | wc -l | tr -d ' ')"
    recent="$(find src tests specs docs drizzle scripts .ai/tasks -type f -mmin -2 2>/dev/null | tail -1 || true)"
    head="$(git rev-parse --short=9 HEAD)"
    echo "[$(date +%H:%M:%S)] CUT ${cut}/${TOTAL_CUTS} sigue trabajando | ${elapsed}s | cambios=${changed} | HEAD=${head}"
    [[ -n "${recent}" ]] && echo "  actividad reciente: ${recent}"
  done
}

run_cut() {
  local index="$1"
  local task_file="$2"
  local log_file="${LOGS_DIR}/cut-${index}-$(basename "${task_file}" .md).log"
  local previous_head current_head started heartbeat_pid exit_code
  previous_head="$(git rev-parse HEAD)"

  echo "============================================================"
  echo "CUT ${index}/${TOTAL_CUTS} — $(date +%Y-%m-%dT%H:%M:%S%z)"
  echo "task: ${TASKS_DIR}/${task_file}"
  echo "log:  ${log_file}"
  echo "HEAD: ${previous_head}"
  echo "============================================================"

  started="$(date +%s)"
  heartbeat "${index}" "${started}" &
  heartbeat_pid=$!

  set +e
  mcode exec \
    --cwd "${REPO_ROOT}" \
    --permission "${CUT_PERMISSION}" \
    --timeout "${CUT_TIMEOUT}" \
    --prompt-mode "work" \
    "$(cat "${TASKS_DIR}/${task_file}")" \
    2>&1 | tee "${log_file}"
  exit_code=$?
  set -e

  kill "${heartbeat_pid}" 2>/dev/null || true
  wait "${heartbeat_pid}" 2>/dev/null || true

  if [[ ${exit_code} -ne 0 ]]; then
    echo "FAILED CUT ${index} (exit=${exit_code})"
    echo "Pipeline detenido. Revisa ${log_file} y git status."
    exit "${exit_code}"
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "FAILED CUT ${index} — working tree sucio:"
    git status --short
    exit 69
  fi

  current_head="$(git rev-parse HEAD)"
  if [[ "${current_head}" == "${previous_head}" ]]; then
    echo "FAILED CUT ${index} — no se generó commit nuevo."
    exit 70
  fi

  echo "SUCCESS CUT ${index}/${TOTAL_CUTS} — ${previous_head:0:9}..${current_head:0:9}"
}

echo "Runner Sales Playbook (feature 008)"
echo "Inicial:   ${INITIAL_HEAD:0:9}"
echo "Cortes:    ${TOTAL_CUTS}"
echo "START_CUT: ${START_CUT}"
echo "Logs:      ${LOGS_DIR}"
echo

for entry in "${TASK_PLAN[@]}"; do
  index="${entry%%:*}"
  task_file="${entry#*:}"
  if (( index < START_CUT )); then
    echo "SKIP CUT ${index}/${TOTAL_CUTS} (${task_file})"
    continue
  fi
  run_cut "${index}" "${task_file}"
done

readonly FINAL_HEAD="$(git rev-parse HEAD)"
echo
echo "============================================================"
echo "PIPELINE COMPLETADO"
echo "Rango: ${INITIAL_HEAD:0:9}..${FINAL_HEAD:0:9}"
git log --oneline "${INITIAL_HEAD}..${FINAL_HEAD}"
echo "============================================================"