/**
 * Sales Playbook — Editor de preguntas Jev (Corte 5, Feature 008, T501-T506).
 *
 * El editor de Jev con **tres clases** de preguntas y candados distintos:
 *
 * | clase            | V1   | key/type | option keys | enabled | duplicar | borrar |
 * |------------------|------|----------|--------------|---------|----------|--------|
 * | engine-required  | 2    | 🔒 fijo  | 🔒 fijas    | 🔒 fijo | no       | no     |
 * | known signal     | 6    | 🔒 fijo  | 🔒 fijas*   | editable| sí*      | no     |
 * | analytical       | ∞    | libre    | libre       | editable| sí       | sí     |
 *
 * \* solo en las `choice` con option keys contractuales
 * (`buying_timing`, `main_value_proposition`).
 *
 * **Ruta única de seguridad**: este componente NO implementa las
 * reglas; las pide a `lib/sales/playbook/constants`
 * (`isJevKeyLocked`, `frozenOptionKeys`, …). El servidor valida
 * siempre con Zod + `assertJevProtectedKeys` (Corte 2 y T505): la UI
 * esconde lo imposible, pero no es la frontera de confianza.
 *
 * **No es un constructor de flujos**: el editor solo cambia la forma
 * de las preguntas (qué se pregunta y con qué keys). El razonamiento
 * y la secuencia siguen siendo del motor.
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  frozenOptionKeys,
  isJevDeletable,
  isJevDuplicable,
  isJevEnabledLocked,
  isJevKeyRenamable,
  JEV_QUESTION_CLASS_ICON,
  JEV_QUESTION_CLASS_LABEL,
  JEV_QUESTION_CLASS_TOOLTIP,
  suggestCopyKey,
  type JevQuestionClass,
  type JevQuestionType,
  classifyJevQuestion,
} from "@/lib/sales/playbook/constants";
import type { ConfigV1 } from "@/lib/sales/playbook/schema";

import { Modal, TextAreaField, TextField } from "./fields";

/* ============================================================
 * Tipos
 * ============================================================ */

export type JevQuestions = ConfigV1["jev_questions"];
type JevQuestion = JevQuestions[string];
type ChoiceQuestion = Extract<JevQuestion, { type: "choice" }>;
type NoulQuestion = Extract<JevQuestion, { type: "noul" }>;
type ScoreQuestion = Extract<JevQuestion, { type: "score" }>;

/** Mismos límites que el Zod, para fallar en el cliente sin red. */
const KEY_REGEX = /^[a-z_]+$/;
const KEY_MAX = 60;
const SCORE_MIN = 2;
const SCORE_MAX = 7;
const TYPE_OPTIONS: readonly JevQuestionType[] = ["choice", "noul", "score"];

const BADGE_VARIANT: Record<JevQuestionClass, "destructive" | "warning" | "secondary"> = {
  "engine-required": "destructive",
  "known-signal": "warning",
  analytical: "secondary",
};

/** `path -> mensaje` para pintar errores de validación bajo el campo. */
type IssueAt = (path: string) => string | undefined;

/* ============================================================
 * JevClassBadge — indicador visual de clase (T501/T506)
 * ============================================================ */

/**
 * Badge de clase con el tooltip que explica **qué está bloqueado y
 * por qué**. El texto vive en `JEV_QUESTION_CLASS_TOOLTIP` (junto a
 * las reglas) para que la explicación no diverja del candado real.
 */
function JevClassBadge({
  cls,
  locked = true,
}: {
  cls: JevQuestionClass;
  /** `false` para preguntas analíticas, que no muestran candado. */
  locked?: boolean;
}) {
  const tooltip = JEV_QUESTION_CLASS_TOOLTIP[cls];
  return (
    <span title={tooltip} data-tooltip={tooltip} className="inline-flex">
      <Badge
        variant={BADGE_VARIANT[cls]}
        aria-label={`${JEV_QUESTION_CLASS_LABEL[cls]}. ${tooltip}`}
      >
        {JEV_QUESTION_CLASS_ICON[cls]}
        <span className="ml-1 hidden sm:inline">
          {locked ? JEV_QUESTION_CLASS_LABEL[cls] : "analítica"}
        </span>
      </Badge>
    </span>
  );
}

/** Candado junto a key/type. Se anula en la fila y en el editor. */
function LockMark({ cls, what }: { cls: JevQuestionClass; what: string }) {
  if (cls === "analytical") return null;
  const tooltip = JEV_QUESTION_CLASS_TOOLTIP[cls];
  return (
    <span
      title={tooltip}
      data-tooltip={tooltip}
      aria-label={`${what} bloqueado: ${tooltip}`}
      className="cursor-help text-sm leading-none"
    >
      🔒
    </span>
  );
}

/* ============================================================
 * ChoiceCriteriaEditor — tabla key/descripción (T502)
 * ============================================================ */

/**
 * Los `criteria` de una pregunta `choice`.
 *
 * Con option keys congeladas (engine-required y las dos known signal
 * `choice`) la tabla se precarga con el set V1 y **no** hay forma de
 * añadir ni quitar keys: solo se edita la descripción. Ese set sale
 * de `frozenOptionKeys`, la misma tabla que usa el Zod.
 */
function ChoiceCriteriaEditor({
  questionKey,
  question,
  onChange,
  issueAt,
}: {
  questionKey: string;
  question: ChoiceQuestion;
  onChange: (next: ChoiceQuestion) => void;
  issueAt: IssueAt;
}) {
  const frozen = frozenOptionKeys(questionKey);
  const entries = React.useMemo(
    () => Object.entries(question.criteria),
    [question.criteria]
  );
  const path = `jev_questions.${questionKey}.criteria`;

  const setDescription = (key: string, value: string) => {
    onChange({
      ...question,
      criteria: { ...question.criteria, [key]: value },
    });
  };

  const setKey = (index: number, nextKey: string) => {
    const copy: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      copy[i === index ? nextKey : k] = v;
    });
    onChange({ ...question, criteria: copy });
  };

  const removeAt = (index: number) => {
    onChange({
      ...question,
      criteria: Object.fromEntries(
        entries.filter((_, i) => i !== index)
      ),
    });
  };

  const addRow = () => {
    let n = entries.length + 1;
    let key = `option_${n}`;
    while (question.criteria[key] !== undefined) {
      n += 1;
      key = `option_${n}`;
    }
    onChange({
      ...question,
      criteria: { ...question.criteria, [key]: "Descripción del criterio" },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          Criterios (opción a elegir)
          <LockMark
            cls={classifyJevQuestion(questionKey)}
            what="Option keys"
          />
        </span>
        <span className="text-xs text-muted-foreground">
          {frozen
            ? "Option keys fijas (contrato del motor) · solo edita descripciones"
            : "Añade o quita opciones libremente"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {entries.map(([key, description], i) => (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                {frozen ? (
                  // T502: con option keys congeladas la clave NO es
                  // un input — se muestra fija y solo la descripción
                  // se edita. Un input aquí invitaría al rename que
                  // el Zod rechaza con `choice_keys_mismatch`.
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">
                      Clave {i + 1}
                      <LockMark
                        cls={classifyJevQuestion(questionKey)}
                        what="Option key"
                      />
                    </span>
                    <p
                      data-testid={`jev-option-key-${questionKey}-${key}`}
                      className="rounded-md border border-dashed bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground"
                    >
                      {key}
                    </p>
                    {issueAt(`${path}.${key}`) ? (
                      <p className="text-xs font-medium text-danger-text" role="alert">
                        {issueAt(`${path}.${key}`)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <TextField
                    label={`Clave ${i + 1}`}
                    value={key}
                    onChange={(next) => setKey(i, next)}
                    hint="^[a-z_]+$"
                    error={issueAt(`${path}.${key}`)}
                  />
                )}
              </div>
              {!frozen ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-6 h-7 w-7"
                  aria-label={`Quitar opción "${key}"`}
                  onClick={() => removeAt(i)}
                >
                  ✕
                </Button>
              ) : null}
            </div>
            <TextAreaField
              label={`Descripción — ${key}`}
              value={description}
              onChange={(next) => setDescription(key, next)}
              rows={2}
            />
          </div>
        ))}
      </div>

      {!frozen ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            + Añadir opción
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
 * Noul / Score criteria
 * ============================================================ */

function NoulCriteriaEditor({
  question,
  onChange,
}: {
  question: NoulQuestion;
  onChange: (next: NoulQuestion) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <TextAreaField
        label="Criterio si es SÍ"
        value={question.criteria.true}
        onChange={(value) =>
          onChange({ ...question, criteria: { ...question.criteria, true: value } })
        }
        rows={3}
      />
      <TextAreaField
        label="Criterio si es NO"
        value={question.criteria.false}
        onChange={(value) =>
          onChange({ ...question, criteria: { ...question.criteria, false: value } })
        }
        rows={3}
      />
    </div>
  );
}

function ScoreCriteriaEditor({
  questionKey,
  question,
  onChange,
  issueAt,
}: {
  questionKey: string;
  question: ScoreQuestion;
  onChange: (next: ScoreQuestion) => void;
  issueAt: IssueAt;
}) {
  const setAt = (index: number, value: string) => {
    const copy = [...question.criteria];
    copy[index] = value;
    onChange({ ...question, criteria: copy });
  };
  const removeAt = (index: number) => {
    onChange({
      ...question,
      criteria: question.criteria.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          Criterios de puntuación
          <LockMark cls={classifyJevQuestion(questionKey)} what="Type" />
        </span>
        <span className="text-xs text-muted-foreground">
          {SCORE_MIN}–{SCORE_MAX} niveles, de peor a mejor
        </span>
      </div>
      {question.criteria.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <TextField
              label={`Nivel ${i + 1}`}
              value={item}
              onChange={(next) => setAt(i, next)}
              error={issueAt(`jev_questions.${questionKey}.criteria.${i}`)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-6 h-7 w-7"
            disabled={question.criteria.length <= SCORE_MIN}
            aria-label={`Quitar nivel ${i + 1}`}
            onClick={() => removeAt(i)}
          >
            ✕
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={question.criteria.length >= SCORE_MAX}
          onClick={() =>
            onChange({
              ...question,
              criteria: [...question.criteria, "Nuevo nivel"],
            })
          }
        >
          + Añadir nivel
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 * QuestionInlineEditor — editor de UNA pregunta (T502)
 * ============================================================ */

function QuestionInlineEditor({
  questionKey,
  question,
  onChange,
  onRenamed,
  onClose,
  issueAt,
}: {
  questionKey: string;
  question: JevQuestion;
  onChange: (next: JevQuestion) => void;
  /** Renombrar la key (solo analíticas); lo aplica el padre. */
  onRenamed: (nextKey: string) => void;
  onClose: () => void;
  issueAt: IssueAt;
}) {
  const cls = classifyJevQuestion(questionKey);
  const enabledLocked = isJevEnabledLocked(questionKey);
  const keyRenamable = isJevKeyRenamable(questionKey);

  return (
    <div
      data-testid={`jev-editor-${questionKey}`}
      className="flex flex-col gap-4 rounded-md border bg-background/60 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <JevClassBadge cls={cls} />
          <span className="text-sm font-semibold">{questionKey}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>

      {/* Key + type: solo editables en analíticas. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Key
            <LockMark cls={cls} what="Key" />
          </span>
          {keyRenamable ? (
            <RenameKeyControl
              currentKey={questionKey}
              onRenamed={onRenamed}
            />
          ) : (
            <p
              data-testid={`jev-locked-key-${questionKey}`}
              className="rounded-md border border-dashed bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground"
            >
              {questionKey}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Tipo
            <LockMark cls={cls} what="Type" />
          </span>
          {/*
            T506: el `type` no se renderiza como selector editable
            para ninguna clase. En las analíticas se muestra igual
            porque cambiarlo exigiría reconstruir los `criteria` (de
            record a array o a par booleano) y el Corte 5 no tenta ese
            camino; el motor solo consume las V1.
          */}
          <p
            data-testid={`jev-locked-type-${questionKey}`}
            className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          >
            {question.type}
          </p>
        </div>
      </div>

      <TextAreaField
        label="Instrucciones para Jev"
        value={question.instructions}
        onChange={(value) => onChange({ ...question, instructions: value })}
        rows={3}
        hint="Cómo debe formular la pregunta (se le entrega al motor tal cual)"
      />

      {question.type === "choice" ? (
        <ChoiceCriteriaEditor
          questionKey={questionKey}
          question={question}
          onChange={onChange}
          issueAt={issueAt}
        />
      ) : null}
      {question.type === "noul" ? (
        <NoulCriteriaEditor question={question} onChange={onChange} />
      ) : null}
      {question.type === "score" ? (
        <ScoreCriteriaEditor
          questionKey={questionKey}
          question={question}
          onChange={onChange}
          issueAt={issueAt}
        />
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={question.enabled}
          aria-label={`Activar ${questionKey}`}
          disabled={enabledLocked}
          title={
            enabledLocked
              ? JEV_QUESTION_CLASS_TOOLTIP["engine-required"]
              : "Desactivar la pregunta (el motor usará su fallback)"
          }
          onClick={() => onChange({ ...question, enabled: !question.enabled })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            question.enabled ? "bg-brand" : "bg-muted"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              question.enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
        <span className="text-sm">
          {enabledLocked
            ? "Activa (obligatoria para el motor)"
            : question.enabled
              ? "Activa"
              : "Desactivada — el motor usará su fallback"}
        </span>
      </div>
    </div>
  );
}

/**
 * Renombrado de una pregunta analítica. Va fuera del editor inline
 * porque renombrar cambia la key del record: lo aplica el padre
 * preservando el orden de las demás entradas.
 */
function RenameKeyControl({
  currentKey,
  onRenamed,
}: {
  currentKey: string;
  onRenamed: (nextKey: string) => void;
}) {
  const [value, setValue] = React.useState(currentKey);
  const tooLong = value.length > KEY_MAX;
  const invalid = value.length > 0 && (!KEY_REGEX.test(value) || tooLong);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <InputLike value={value} onChange={setValue} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value === currentKey || invalid}
          onClick={() => onRenamed(value)}
        >
          Renombrar
        </Button>
      </div>
      {invalid ? (
        <p className="text-xs font-medium text-danger-text" role="alert">
          {tooLong
            ? `Máximo ${KEY_MAX} caracteres.`
            : "Solo minúsculas y guion bajo (^[a-z_]+$)."}
        </p>
      ) : null}
    </div>
  );
}

function InputLike({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Key de la pregunta"
      className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

/* ============================================================
 * NewQuestionModal — crear pregunta analítica (T503)
 * ============================================================ */

function NewQuestionModal({
  open,
  takenKeys,
  onClose,
  onCreate,
}: {
  open: boolean;
  takenKeys: string[];
  onClose: () => void;
  onCreate: (key: string, type: JevQuestionType, instructions: string) => void;
}) {
  const [type, setType] = React.useState<JevQuestionType>("noul");
  const [key, setKey] = React.useState("");
  const [instructions, setInstructions] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setType("noul");
      setKey("");
      setInstructions("");
    }
  }, [open]);

  const trimmed = key.trim();
  const error = (() => {
    if (trimmed.length === 0) return null;
    if (trimmed.length > KEY_MAX) return `Máximo ${KEY_MAX} caracteres.`;
    if (!KEY_REGEX.test(trimmed)) {
      return "Solo minúsculas, números no: usa letras y guion bajo (^[a-z_]+$).";
    }
    if (takenKeys.includes(trimmed)) {
      return `La key "${trimmed}" ya existe. Elige otra.`;
    }
    return null;
  })();

  const canCreate = trimmed.length > 0 && error === null;

  return (
    <Modal open={open} title="Nueva pregunta analítica" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Se guardará como <strong>analítica ➕</strong>: el motor la persiste
          pero no la consume. No puedes crear keys del contrato del motor.
        </p>

        <div className="flex flex-col gap-1.5">
          <label
            className="text-sm font-medium"
            htmlFor="jev-new-type"
          >
            Tipo de pregunta
          </label>
          <select
            id="jev-new-type"
            value={type}
            onChange={(e) => setType(e.target.value as JevQuestionType)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <TextField
          label="Key"
          value={key}
          onChange={setKey}
          hint="^[a-z_]+$ · sin números"
          placeholder="competitor_price_asked"
          error={error ?? undefined}
        />

        <TextAreaField
          label="Instrucciones iniciales"
          value={instructions}
          onChange={setInstructions}
          rows={3}
          placeholder="¿Ha mencionado un competente con precio explícito?"
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate(trimmed, type, instructions.trim())}
          >
            Crear pregunta
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
 * JevQuestionsEditor — la lista (T501)
 * ============================================================ */

export function JevQuestionsEditor({
  questions,
  onChange,
  issueAt,
}: {
  questions: JevQuestions;
  /** Recibe el `jev_questions` completo; el padre lo mete en el config. */
  onChange: (next: JevQuestions) => void;
  issueAt: IssueAt;
}) {
  const keys = React.useMemo(() => Object.keys(questions), [questions]);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const counts = React.useMemo(() => {
    const acc: Record<JevQuestionClass, number> = {
      "engine-required": 0,
      "known-signal": 0,
      analytical: 0,
    };
    for (const k of keys) acc[classifyJevQuestion(k)] += 1;
    return acc;
  }, [keys]);

  /** Reordena preservando el resto del record. */
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;
    const nextKeys = [...keys];
    const [a] = nextKeys.splice(index, 1);
    if (a === undefined) return;
    nextKeys.splice(target, 0, a);
    const copy: JevQuestions = {};
    for (const k of nextKeys) {
      const q = questions[k];
      if (q !== undefined) copy[k] = q;
    }
    onChange(copy);
  };

  const setQuestion = (key: string, next: JevQuestion) => {
    onChange({ ...questions, [key]: next });
  };

  const removeQuestion = (key: string) => {
    const copy: JevQuestions = {};
    for (const [k, v] of Object.entries(questions)) {
      if (k !== key) copy[k] = v;
    }
    if (openKey === key) setOpenKey(null);
    onChange(copy);
  };

  /**
   * Duplicar (T504). Las `engine-required` no se pueden duplicar.
   * Una copia siempre nace **analítica**: la key lleva `_copy`, que
   * no está en el catálogo protegido, así que el motor no la trata
   * como contrato aunque comparta forma con una señal.
   */
  const duplicateQuestion = (key: string) => {
    const source = questions[key];
    if (source === undefined) return;
    const nextKey = suggestCopyKey(key, keys);
    onChange({ ...questions, [nextKey]: { ...structuredClone(source) } });
    setOpenKey(nextKey);
  };

  const createQuestion = (
    key: string,
    type: JevQuestionType,
    instructions: string
  ) => {
    const question: JevQuestion =
      type === "choice"
        ? {
            type: "choice",
            enabled: true,
            instructions:
              instructions || "Describe el criterio de esta pregunta.",
            criteria: {
              option_a: "Descripción del primer criterio",
              option_b: "Descripción del segundo criterio",
            },
          }
        : type === "score"
          ? {
              type: "score",
              enabled: true,
              instructions: instructions || "Puntúa esta señal.",
              criteria: ["Nivel más bajo", "Nivel más alto"],
            }
          : {
              type: "noul",
              enabled: true,
              instructions: instructions || "Formula la pregunta.",
              criteria: {
                true: "Criterio cuando la respuesta es sí",
                false: "Criterio cuando la respuesta es no",
              },
            };
    onChange({ ...questions, [key]: question });
    setOpenKey(key);
    setCreateOpen(false);
  };

  /**
   * Renombrar una analítica (T501). Preserva la posición de la
   * entrada y el resto del documento; el Zod rechazará cualquier key
   * mal formada antes de persistir.
   */
  const renameQuestion = (from: string, to: string) => {
    const trimmed = to.trim();
    if (from === trimmed || questions[trimmed] !== undefined) return;
    if (!KEY_REGEX.test(trimmed) || trimmed.length > KEY_MAX) return;
    const copy: JevQuestions = {};
    for (const [k, v] of Object.entries(questions)) {
      copy[k === from ? trimmed : k] = v;
    }
    onChange(copy);
    setOpenKey(trimmed);
  };

  return (
    <div data-testid="jev-questions-editor" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="destructive">
            🔒 engine-required: {counts["engine-required"]}
          </Badge>
          <Badge variant="warning">📊 known signals: {counts["known-signal"]}</Badge>
          <Badge variant="secondary">➕ analíticas: {counts.analytical}</Badge>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setCreateOpen(true)}
          data-testid="jev-new-question"
        >
          + Nueva pregunta
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {keys.map((key, index) => {
          const question = questions[key];
          if (question === undefined) return null;
          const cls = classifyJevQuestion(key);
          const isOpen = openKey === key;
          return (
            <li
              key={key}
              data-testid={`jev-row-${key}`}
              data-jev-class={cls}
              className="rounded-md border bg-card p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <JevClassBadge cls={cls} />
                  <span
                    data-testid={`jev-key-${key}`}
                    className="font-mono text-sm font-medium"
                  >
                    {key}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span data-testid={`jev-type-${key}`}>{question.type}</span>
                    <LockMark cls={cls} what="Key y type" />
                  </span>
                  {!question.enabled ? (
                    <Badge variant="outline">desactivada</Badge>
                  ) : null}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === 0}
                    aria-label={`Subir ${key}`}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === keys.length - 1}
                    aria-label={`Bajar ${key}`}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`jev-edit-${key}`}
                    onClick={() => setOpenKey(isOpen ? null : key)}
                  >
                    {isOpen ? "Cerrar" : "Editar"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!isJevDuplicable(key)}
                    title={
                      isJevDuplicable(key)
                        ? "Duplicar (la copia nace como analítica)"
                        : "No se puede duplicar: es contrato del motor"
                    }
                    data-testid={`jev-duplicate-${key}`}
                    onClick={() => duplicateQuestion(key)}
                  >
                    Duplicar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!isJevDeletable(key)}
                    title={
                      isJevDeletable(key)
                        ? "Eliminar"
                        : "No se puede eliminar: la reconoce el motor"
                    }
                    data-testid={`jev-delete-${key}`}
                    onClick={() => removeQuestion(key)}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>

              {isOpen ? (
                <div className="mt-3">
                  <QuestionInlineEditor
                    questionKey={key}
                    question={question}
                    onChange={(next) => setQuestion(key, next)}
                    onRenamed={(nextKey) => renameQuestion(key, nextKey)}
                    onClose={() => setOpenKey(null)}
                    issueAt={issueAt}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <NewQuestionModal
        open={createOpen}
        takenKeys={keys}
        onClose={() => setCreateOpen(false)}
        onCreate={createQuestion}
      />
    </div>
  );
}
