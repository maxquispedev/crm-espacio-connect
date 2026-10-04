#!/usr/bin/env bash
# run-operator-workspace-mcode.sh
# Loop autónomo por cortes SDD: 013 Operator Workspace (cortes 1-5) y
# 014 Espacio Connect rebrand + rediseño (cortes 6-8).
# Cada corte usa una sesión NUEVA de `mcode exec`. Sin --continue, sin --session,
# sin dependencia de un chat anterior. Un corte = un objetivo = un commit.
# Ejecutar SOLO desde Bash/WSL externo, en la raíz; nunca dentro de mcode.
#
#   START_CUT=1 END_CUT=5 CUT_TIMEOUT=90m bash scripts/ai/run-operator-workspace-mcode.sh
#   START_CUT=6 END_CUT=8 CUT_TIMEOUT=90m bash scripts/ai/run-operator-workspace-mcode.sh
#
# Fallo: conserva los cambios, revisa el log del corte y termina SOLO ese corte en
# una sesión nueva antes de reanudar en N+1. Nunca reset/checkout/clean/stash/rebase
# ni auto-revert automáticos.
#
# Defaults: START_CUT=1 END_CUT=8 CUT_TIMEOUT=90m HEARTBEAT_SECONDS=25
set -Eeuo pipefail

readonly REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" || "${REPO_ROOT}" != "$(pwd)" ]]; then
  echo "ERROR: ejecutar desde la raíz del repositorio." >&2
  exit 64
fi

# Nunca anidado dentro de una sesión de mcode (ni de otro agente).
if [[ -n "${MCODE_SESSION_ID:-}" || -n "${MINIMAX_SESSION_ID:-}" ]]; then
  echo "ERROR: ejecutar desde una terminal Bash/WSL fuera de la sesión de mcode." >&2
  exit 64
fi

for bin in mcode git grep tee timeout cat date sleep find tail wc tr basename mkdir sort head cut; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: '${bin}' no está disponible en PATH." >&2
    exit 65
  fi
done

readonly TASKS_DIR="${REPO_ROOT}/.ai/tasks/operator-workspace"
readonly LOGS_DIR="${REPO_ROOT}/.ai/logs/operator-workspace"
readonly TASK_PLAN=(
  "1:01-cut1-attention-state.md"
  "2:02-cut2-por-atender-queue.md"
  "3:03-cut3-agenda-human-reminders.md"
  "4:04-cut4-operational-flow.md"
  "5:05-cut5-verification.md"
  "6:06-cut6-rebrand.md"
  "7:07-cut7-redesign.md"
  "8:08-cut8-polish-regression.md"
)
readonly TOTAL_CUTS="${#TASK_PLAN[@]}"

if [[ ! -d "${TASKS_DIR}" ]]; then
  echo "ERROR: no existe ${TASKS_DIR}." >&2
  exit 67
fi
for entry in "${TASK_PLAN[@]}"; do
  task_file="${entry#*:}"
  if [[ ! -f "${TASKS_DIR}/${task_file}" ]]; then
    echo "ERROR: falta ${TASKS_DIR}/${task_file}" >&2
    exit 67
  fi
done
readonly SPEC_013="${REPO_ROOT}/specs/013-operator-workspace"
readonly SPEC_014="${REPO_ROOT}/specs/014-espacio-connect-rebrand"
for required in \
  "${SPEC_013}/spec.md" "${SPEC_013}/plan.md" "${SPEC_013}/tasks.md" \
  "${SPEC_013}/quickstart.md" \
  "${SPEC_014}/spec.md" "${SPEC_014}/plan.md" "${SPEC_014}/tasks.md"; do
  if [[ ! -f "${required}" ]]; then
    echo "ERROR: falta el artefacto SDD ${required#"${REPO_ROOT}/"}" >&2
    exit 67
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree sucio antes de iniciar." >&2
  echo "Si es trabajo parcial de un corte fallido, NO lo descartes:" >&2
  echo "inspecciona 'git status' y 'git log --oneline -5', y reanuda con START_CUT=N." >&2
  git status --short >&2
  exit 68
fi

START_CUT="${START_CUT:-1}"
END_CUT="${END_CUT:-8}"
if ! [[ "${START_CUT}" =~ ^[1-8]$ && "${END_CUT}" =~ ^[1-8]$ ]] || (( START_CUT > END_CUT )); then
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

# ---------------------------------------------------------------------------
# Preflight de la interfaz REAL de mcode. No se asumen flags: se leen del CLI
# instalado y se falla en el preflight si algo no existe.
# ---------------------------------------------------------------------------
MCODE_HELP="$(mcode exec --help 2>&1)" || {
  echo "ERROR: 'mcode exec' no disponible." >&2
  exit 65
}
readonly MCODE_HELP

mcode_require_flag() {
  if ! grep -q -- "$1" <<<"${MCODE_HELP}"; then
    echo "ERROR: 'mcode exec' no expone ${1} (mcode $(mcode --version 2>&1 | head -1))." >&2
    echo "Actualiza la CLI o ajusta el runner; no se degrada a modo interactivo." >&2
    exit 65
  fi
}
# Sesión nueva por corte: `--continue` y `--session` NO se usan nunca, así que cada
# corte arranca sin contexto del anterior. Los flags que sí usamos se verifican aquí
# contra el CLI realmente instalado, para fallar en el preflight y no a mitad de un
# corte.
mcode_require_flag "--cwd"
mcode_require_flag "--permission"
mcode_require_flag "--prompt-mode"
mcode_require_flag "--output-format"

# Política de permisos: `full` (equivalente al auto-approve de otros runners).
# Si esta versión no la aceptara, se detecta al ejecutar el corte, no aquí.
readonly MCODE_PERMISSION="${MCODE_PERMISSION:-full}"
readonly MCODE_PROMPT_MODE="${MCODE_PROMPT_MODE:-coding}"
readonly MCODE_OUTPUT_FORMAT="${MCODE_OUTPUT_FORMAT:-text}"

mkdir -p "${LOGS_DIR}"
# Los logs deben permanecer ignorados para no ensuciar el árbol por sí mismos.
if ! git check-ignore -q "${LOGS_DIR}/preflight.log"; then
  echo "ERROR: los logs .ai/logs/operator-workspace/*.log deben estar ignorados." >&2
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
    echo "spec:   $( ((index <= 5)) && echo 'specs/013-operator-workspace' || echo 'specs/014-espacio-connect-rebrand' )"
    echo "task:   ${TASKS_DIR}/${task_file}"
    echo "log:    ${log_file}"
    echo "HEAD:   ${previous_head}"
    echo "mcode:  $(mcode --version 2>&1 | head -1) exec --permission ${MCODE_PERMISSION} --prompt-mode ${MCODE_PROMPT_MODE}"
    echo "============================================================"
  } | tee "${log_file}"

  started="$(date +%s)"
  heartbeat "${index}" "${started}" "${log_file}" &
  heartbeat_pid=$!

  # Sesión NUEVA por corte: sin --continue ni --session. El prompt del task file es
  # autosuficiente. GNU timeout impide que un corte se cuelgue indefinidamente.
  set +e
  (
    cd "${REPO_ROOT}" || exit 64
    timeout --kill-after=30s "${CUT_TIMEOUT}" \
      mcode exec \
        --cwd "${REPO_ROOT}" \
        --permission "${MCODE_PERMISSION}" \
        --prompt-mode "${MCODE_PROMPT_MODE}" \
        --output-format "${MCODE_OUTPUT_FORMAT}" \
        "$(cat "${TASKS_DIR}/${task_file}")" < /dev/null
  ) 2>&1 | tee -a "${log_file}"
  pipeline_status=("${PIPESTATUS[@]}")
  set -e
  exit_code="${pipeline_status[0]}"
  # tee fallando también detiene el loop aunque mcode termine con éxito.
  if (( exit_code == 0 && pipeline_status[1] != 0 )); then
    exit_code="${pipeline_status[1]}"
  fi
  stop_heartbeat

  if [[ ${exit_code} -ne 0 ]]; then
    echo "FAILED CUT ${index} (exit=${exit_code})"
    echo "Pipeline detenido. Revisa ${log_file} y git status."
    echo "NO resetees ni descartes cambios: relanza este mismo corte en una sesión nueva."
    echo "Los cambios quedan en el árbol; este runner nunca hace reset/clean/checkout/stash/rebase."
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
    echo "FAILED CUT ${index} — no se generó commit nuevo (STOP: el corte debe commitear)."
    exit 70
  fi

  if [[ "$(git show -s --format=%P "${current_head}")" != "${previous_head}" ]]; then
    echo "FAILED CUT ${index} — se exige exactamente UN commit atómico descendiente de HEAD inicial."
    echo "Conservar commits/cambios e inspeccionar el historial; no recuperación automática."
    exit 70
  fi

  echo "SUCCESS CUT ${index}/${TOTAL_CUTS} — ${previous_head:0:9}..${current_head:0:9}"
  git log -1 --format='          %h %s' "${current_head}" | tee -a "${log_file}"
}

echo "Runner Operator Workspace + Espacio Connect (specs 013 y 014)"
echo "Inicial:   ${INITIAL_HEAD:0:9}"
echo "Cortes:    ${TOTAL_CUTS} (1-5 spec 013 · 6-8 spec 014)"
echo "START_CUT: ${START_CUT}"
echo "END_CUT:   ${END_CUT}"
echo "Timeout:   ${CUT_TIMEOUT}"
echo "mcode:     $(mcode --version 2>&1 | head -1) exec (sesión nueva por corte, sin --continue)"
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
echo "Revisar gates, evidencia y E2E en los tasks.md de 013 y 014 antes de seguir."
echo "============================================================"
