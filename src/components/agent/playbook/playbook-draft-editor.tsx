/**
 * Sales Playbook — Editor por bloques del DRAFT (Corte 4, Feature 008, T404).
 *
 * Ocho bloques funcionales: Producto, Oferta, Política, Prioridades,
 * Writer, Prohibiciones, Handoff y Urgencia. **No hay JSON crudo**: cada
 * bloque es un formulario con su propio componente.
 *
 * Las preguntas Jev NO se editan aquí (Corte 5): esta vista solo
 * muestra el conteo y el badge por clase.
 *
 * Validación: al cambiar cualquier campo se manda el documento
 * ENTERO a `POST /api/playbook/validate` con throttle de 300 ms, y los
 * errores se pintan en rojo debajo del campo correspondiente. La
 * validación es la misma que el servidor aplica al guardar, así que
 * "pinta verde" significa "el PUT no fallará por validación".
 *
 * Guardar (`PUT /api/playbook/draft`) y Descartar (refetch) los
 * orchestrea `playbook-client`; este componente solo edita estado
 * local y avisa.
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  WRITER_NEXT_ACTIONS,
  type JevQuestionClass,
} from "@/lib/sales/playbook/constants";
import type { ConfigV1 } from "@/lib/sales/playbook/schema";

import {
  BlockSection,
  NumberField,
  SelectField,
  StringListEditor,
  SwitchField,
  TextAreaField,
  TextField,
} from "./fields";
import { countJevByClass, jevClassIcon, jevClassLabel } from "./summary";
import type { PlaybookVersionDto, ValidationIssue } from "./types";

const CURRENCY_OPTIONS = ["PEN", "USD", "MXN", "EUR"] as const;
const CHANNEL_OPTIONS = ["WhatsApp", "WhatsApp+SMS", "WhatsApp+Email"] as const;

const JEV_BADGE_VARIANT: Record<
  JevQuestionClass,
  "destructive" | "warning" | "secondary"
> = {
  "engine-required": "destructive",
  "known-signal": "warning",
  analytical: "secondary",
};

/**
 * Construye un lookup `path -> mensaje` desde los `details` del 422 de
 * `/api/playbook/validate` (los paths llegan como "product.name",
 * "priorities.primary.0"…). Devolvemos una función para no
 * recalcular en cada render.
 */
function makeIssueIndex(issues: ValidationIssue[]): (path: string) => string | undefined {
  const index = new Map<string, string>();
  for (const issue of issues) {
    // En arrays el path trae el índice; el error suele señalar el
    // elemento exacto, así que guardamos también la versión "de la
    // lista" como fallback para pintar el error bajo la lista entera.
    const exact = issue.path;
    if (!index.has(exact)) index.set(exact, issue.message);
    const parent = exact.replace(/\.\d+$/, "");
    if (parent !== exact && !index.has(parent)) index.set(parent, issue.message);
    const head = exact.split(".")[0];
    if (head && !index.has(head)) index.set(head, issue.message);
  }
  return (path: string) => index.get(path);
}

export function PlaybookDraftEditor({
  draft,
  issues,
  saving,
  publishing,
  onSave,
  onDiscard,
  onPublish,
  onDelete,
  canDelete,
  deleting,
}: {
  draft: PlaybookVersionDto;
  /** Errores vivos de `/api/playbook/validate`. */
  issues: ValidationIssue[];
  saving: boolean;
  publishing: boolean;
  onSave: (config: ConfigV1) => void;
  onDiscard: () => void;
  onPublish: () => void;
  onDelete: () => void;
  /** Solo se permite eliminar draft si hay una publicada activa. */
  canDelete: boolean;
  deleting: boolean;
}) {
  // Estado local del documento editable. Se reinicia cuando cambia el
  // draft (refetch / creación de otro draft).
  const [config, setConfig] = React.useState<ConfigV1>(() => ({
    schema_version: draft.schema_version as ConfigV1["schema_version"],
    product: draft.product,
    offer: draft.offer,
    commercial_policy: draft.commercial_policy,
    priorities: draft.priorities,
    writer: draft.writer,
    jev_questions: draft.jev_questions,
    prohibitions: draft.prohibitions,
    handoff: draft.handoff,
    urgency_rules: draft.urgency_rules,
  }));
  const [notes, setNotes] = React.useState<string>(draft.notes ?? "");
  /** Marca el documento como sucio para habilitar Guardar. */
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setConfig({
      schema_version: draft.schema_version as ConfigV1["schema_version"],
      product: draft.product,
      offer: draft.offer,
      commercial_policy: draft.commercial_policy,
      priorities: draft.priorities,
      writer: draft.writer,
      jev_questions: draft.jev_questions,
      prohibitions: draft.prohibitions,
      handoff: draft.handoff,
      urgency_rules: draft.urgency_rules,
    });
    setNotes(draft.notes ?? "");
    // Un refetch (guardar, descartar, otro draft) descarta lo local: el
    // documentoEditable vuelve a coincidir con el del servidor.
    setDirty(false);
  }, [draft]);

  const patch = React.useCallback(
    <K extends keyof ConfigV1>(key: K, value: ConfigV1[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    []
  );

  // ---- Validación con throttle de 300 ms -------------------------------
  const [validationIssues, setValidationIssues] = React.useState<ValidationIssue[]>([]);
  const [checking, setChecking] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = React.useRef(0);

  const scheduleValidate = React.useCallback((next: ConfigV1) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const seq = ++seqRef.current;
      setChecking(true);
      void (async () => {
        try {
          const res = await fetch("/api/playbook/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          });
          if (seq !== seqRef.current) return; // llegó una respuesta más nueva
          if (res.ok) {
            setValidationIssues([]);
          } else {
            const body = (await res.json()) as { details?: ValidationIssue[] };
            setValidationIssues(body.details ?? []);
          }
        } catch {
          if (seq === seqRef.current) {
            setValidationIssues([
              {
                path: "",
                message: "No se pudo validar en línea; se validará al guardar.",
              },
            ]);
          }
        } finally {
          if (seq === seqRef.current) setChecking(false);
        }
      })();
    }, 300);
  }, []);

  // Validar también en el primer render (el doc ya guardado puede venir
  // con errores si se editó fuera del editor).
  React.useEffect(() => {
    scheduleValidate(config);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Solo al cambiar el documento; `scheduleValidate` es estable.
  }, [config, scheduleValidate]);

  // Combina los errores que llegan por prop (guardados por el padre al
  // hacer PUT) con los vivos del throttle.
  const allIssues = React.useMemo(
    () => (issues.length > 0 ? issues : validationIssues),
    [issues, validationIssues]
  );
  const issueAt = React.useMemo(() => makeIssueIndex(allIssues), [allIssues]);
  const hasErrors = allIssues.length > 0;

  const counts = countJevByClass(config.jev_questions);
  const totalQuestions = Object.keys(config.jev_questions).length;

  const handleSave = () => {
    onSave({ ...config, urgency_rules: config.urgency_rules ?? null });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Draft V{draft.version_number}</CardTitle>
            <CardDescription>
              schema {draft.schema_version} · creado {new Date(draft.created_at).toLocaleString("es-PE")}
            </CardDescription>
          </div>
          <Badge variant="warning">Borrador</Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* ================= Resumen Jev (read-only, Corte 5) ========== */}
        <div className="rounded-md border bg-secondary/30 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              Preguntas Jev · {totalQuestions} en total
            </span>
            <span className="text-xs text-muted-foreground">
              No editables en este corte
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={JEV_BADGE_VARIANT["engine-required"]}>
              {jevClassIcon("engine-required")} {jevClassLabel("engine-required")}:{" "}
              {counts["engine-required"]}
            </Badge>
            <Badge variant={JEV_BADGE_VARIANT["known-signal"]}>
              {jevClassIcon("known-signal")} {jevClassLabel("known-signal")}:{" "}
              {counts["known-signal"]}
            </Badge>
            <Badge variant={JEV_BADGE_VARIANT.analytical}>
              {jevClassIcon("analytical")} {jevClassLabel("analytical")}:{" "}
              {counts.analytical}
            </Badge>
          </div>
        </div>

        {/* ================= 1. Producto ============================== */}
        <BlockSection
          title="Producto"
          description="Qué vendes, para quién y cómo empieza."
        >
          <TextField
            label="Nombre"
            value={config.product.name}
            error={issueAt("product.name")}
            onChange={(v) =>
              patch("product", { ...config.product, name: v })
            }
          />
          <TextAreaField
            label="One-liner"
            value={config.product.one_liner}
            error={issueAt("product.one_liner")}
            onChange={(v) =>
              patch("product", { ...config.product, one_liner: v })
            }
          />
          <StringListEditor
            label="¿Para quién es?"
            items={config.product.who_it_is_for}
            required
            max={20}
            error={issueAt("product.who_it_is_for")}
            placeholder="Colegios con 200–800 alumnos"
            onChange={(v) =>
              patch("product", { ...config.product, who_it_is_for: v })
            }
          />
          <StringListEditor
            label="Trabajos principales que resuelve"
            items={config.product.core_jobs}
            required
            max={30}
            error={issueAt("product.core_jobs")}
            placeholder="Manejar la agenda deffyans"
            onChange={(v) =>
              patch("product", { ...config.product, core_jobs: v })
            }
          />
          <StringListEditor
            label="NO es este producto"
            items={config.product.not_the_product}
            max={20}
            error={issueAt("product.not_the_product")}
            placeholder="No es un CRM genérico"
            onChange={(v) =>
              patch("product", { ...config.product, not_the_product: v })
            }
          />
          <TextAreaField
            label="Cómo empieza (onboarding)"
            value={config.product.how_it_starts}
            error={issueAt("product.how_it_starts")}
            onChange={(v) =>
              patch("product", { ...config.product, how_it_starts: v })
            }
          />
        </BlockSection>

        {/* ================= 2. Oferta =============================== */}
        <BlockSection
          title="Oferta"
          description="Precio, lo que incluye y lo que nunca prometes."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Moneda"
              value={config.offer.currency}
              options={CURRENCY_OPTIONS}
              error={issueAt("offer.currency")}
              onChange={(v) =>
                patch("offer", {
                  ...config.offer,
                  currency: v as ConfigV1["offer"]["currency"],
                })
              }
            />
            <SwitchField
              label="El setup es un pago único"
              checked={config.offer.setupIsOneTime}
              onChange={(v) => patch("offer", { ...config.offer, setupIsOneTime: v })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Setup"
              value={config.offer.setup}
              min={0}
              error={issueAt("offer.setup")}
              onChange={(v) => patch("offer", { ...config.offer, setup: v })}
            />
            <NumberField
              label="Mensualidad base"
              value={config.offer.monthlyBase}
              min={0}
              error={issueAt("offer.monthlyBase")}
              onChange={(v) => patch("offer", { ...config.offer, monthlyBase: v })}
            />
            <NumberField
              label="Alumnos activos incluidos"
              value={config.offer.includedActiveStudents}
              min={1}
              error={issueAt("offer.includedActiveStudents")}
              onChange={(v) =>
                patch("offer", { ...config.offer, includedActiveStudents: v })
              }
            />
            <NumberField
              label="Extra por alumno activo adicional"
              value={config.offer.extraPerActiveStudent}
              min={0}
              error={issueAt("offer.extraPerActiveStudent")}
              onChange={(v) =>
                patch("offer", { ...config.offer, extraPerActiveStudent: v })
              }
            />
          </div>
          <TextField
            label="Propósito de la implementación"
            value={config.offer.implementation.purpose}
            error={issueAt("offer.implementation.purpose")}
            onChange={(v) =>
              patch("offer", {
                ...config.offer,
                implementation: { ...config.offer.implementation, purpose: v },
              })
            }
          />
          <StringListEditor
            label="La implementación incluye"
            items={config.offer.implementation.includes}
            required
            max={20}
            error={issueAt("offer.implementation.includes")}
            onChange={(v) =>
              patch("offer", {
                ...config.offer,
                implementation: { ...config.offer.implementation, includes: v },
              })
            }
          />
          <StringListEditor
            label="Nunca prometer (oferta)"
            items={config.offer.neverPromise}
            required
            max={20}
            error={issueAt("offer.neverPromise")}
            hint="También aparece en Prohibiciones"
            onChange={(v) => patch("offer", { ...config.offer, neverPromise: v })}
          />
        </BlockSection>

        {/* ================= 3. Política comercial =================== */}
        <BlockSection
          title="Política comercial"
          description="Canal por defecto y reglas de la conversación."
        >
          <SelectField
            label="Canal por defecto"
            value={config.commercial_policy.defaultChannel}
            options={CHANNEL_OPTIONS}
            error={issueAt("commercial_policy.defaultChannel")}
            onChange={(v) =>
              patch("commercial_policy", {
                ...config.commercial_policy,
                defaultChannel: v as ConfigV1["commercial_policy"]["defaultChannel"],
              })
            }
          />
          <TextAreaField
            label="Objetivo comercial"
            value={config.commercial_policy.goal}
            error={issueAt("commercial_policy.goal")}
            onChange={(v) =>
              patch("commercial_policy", { ...config.commercial_policy, goal: v })
            }
          />
          <TextAreaField
            label="Automatizar primero"
            value={config.commercial_policy.automationFirst}
            error={issueAt("commercial_policy.automationFirst")}
            onChange={(v) =>
              patch("commercial_policy", {
                ...config.commercial_policy,
                automationFirst: v,
              })
            }
          />
          <TextAreaField
            label="Cierre automático"
            value={config.commercial_policy.autoClose}
            error={issueAt("commercial_policy.autoClose")}
            onChange={(v) =>
              patch("commercial_policy", { ...config.commercial_policy, autoClose: v })
            }
          />
          <TextAreaField
            label="Traspaso a humano"
            value={config.commercial_policy.humanHandoff}
            error={issueAt("commercial_policy.humanHandoff")}
            onChange={(v) =>
              patch("commercial_policy", {
                ...config.commercial_policy,
                humanHandoff: v,
              })
            }
          />
          <TextAreaField
            label="Interés futuro"
            value={config.commercial_policy.futureInterest}
            error={issueAt("commercial_policy.futureInterest")}
            onChange={(v) =>
              patch("commercial_policy", {
                ...config.commercial_policy,
                futureInterest: v,
              })
            }
          />
          <TextAreaField
            label="Sin respuesta"
            value={config.commercial_policy.noResponse}
            error={issueAt("commercial_policy.noResponse")}
            onChange={(v) =>
              patch("commercial_policy", { ...config.commercial_policy, noResponse: v })
            }
          />
          <TextAreaField
            label="Descalificación"
            value={config.commercial_policy.disqualification}
            error={issueAt("commercial_policy.disqualification")}
            onChange={(v) =>
              patch("commercial_policy", {
                ...config.commercial_policy,
                disqualification: v,
              })
            }
          />
          <TextAreaField
            label="Regla de evidencia"
            value={config.commercial_policy.evidenceRule}
            error={issueAt("commercial_policy.evidenceRule")}
            onChange={(v) =>
              patch("commercial_policy", {
                ...config.commercial_policy,
                evidenceRule: v,
              })
            }
          />
        </BlockSection>

        {/* ================= 4. Prioridades ========================== */}
        <BlockSection
          title="Prioridades"
          description="El orden importa: usa las flechas para reordenar. Máximo 8 por nivel."
        >
          <StringListEditor
            label="Prioridad principal"
            items={config.priorities.primary}
            required
            max={8}
            orderable
            error={issueAt("priorities.primary")}
            onChange={(v) => patch("priorities", { ...config.priorities, primary: v })}
          />
          <StringListEditor
            label="Prioridad secundaria"
            items={config.priorities.secondary}
            max={8}
            orderable
            error={issueAt("priorities.secondary")}
            onChange={(v) =>
              patch("priorities", { ...config.priorities, secondary: v })
            }
          />
          <StringListEditor
            label="Prioridad terciaria"
            items={config.priorities.tertiary}
            max={8}
            orderable
            error={issueAt("priorities.tertiary")}
            onChange={(v) =>
              patch("priorities", { ...config.priorities, tertiary: v })
            }
          />
        </BlockSection>

        {/* ================= 5. Writer =============================== */}
        <BlockSection
          title="Writer"
          description="Instrucción del agente para cada next_action. Una por opción, en orden fijo."
        >
          {WRITER_NEXT_ACTIONS.map((action) => (
            <TextAreaField
              key={action.key}
              label={action.label}
              value={config.writer[action.key]}
              error={issueAt(`writer.${action.key}`)}
              rows={3}
              onChange={(v) =>
                patch("writer", { ...config.writer, [action.key]: v })
              }
            />
          ))}
        </BlockSection>

        {/* ================= 6. Prohibiciones ======================== */}
        <BlockSection
          title="Prohibiciones"
          description="Límites de lo que el agente puede afirmar."
        >
          <StringListEditor
            label="Promesas prohibidas"
            items={config.prohibitions.prohibitedClaims}
            max={20}
            error={issueAt("prohibitions.prohibitedClaims")}
            onChange={(v) =>
              patch("prohibitions", { ...config.prohibitions, prohibitedClaims: v })
            }
          />
          <div className="rounded-md border bg-secondary/30 p-3">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Referencia: «nunca prometer» de la Oferta
            </span>
            {config.offer.neverPromise.length > 0 ? (
              <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-5 text-sm text-text-2">
                {config.offer.neverPromise.map((item, i) => (
                  <li key={`${item}-${i}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                La oferta no declara promesas prohibidas.
              </p>
            )}
          </div>
        </BlockSection>

        {/* ================= 7. Handoff ============================== */}
        <BlockSection
          title="Handoff"
          description="Qué hace el sistema en cada punto de entrega."
        >
          <TextAreaField
            label="Automático (auto)"
            value={config.handoff.auto ?? ""}
            error={issueAt("handoff.auto")}
            onChange={(v) => patch("handoff", { ...config.handoff, auto: v })}
          />
          <TextAreaField
            label="Cierre automático (auto_close)"
            value={config.handoff.auto_close ?? ""}
            error={issueAt("handoff.auto_close")}
            onChange={(v) => patch("handoff", { ...config.handoff, auto_close: v })}
          />
          <TextAreaField
            label="Humano (human)"
            value={config.handoff.human ?? ""}
            error={issueAt("handoff.human")}
            onChange={(v) => patch("handoff", { ...config.handoff, human: v })}
          />
          <TextAreaField
            label="Espera (wait)"
            value={config.handoff.wait ?? ""}
            error={issueAt("handoff.wait")}
            onChange={(v) => patch("handoff", { ...config.handoff, wait: v })}
          />
          <TextAreaField
            label="Parada (stop)"
            value={config.handoff.stop ?? ""}
            error={issueAt("handoff.stop")}
            onChange={(v) => patch("handoff", { ...config.handoff, stop: v })}
          />
        </BlockSection>

        {/* ================= 8. Urgencia ============================= */}
        <BlockSection
          title="Urgencia"
          description="Reglas de urgencia al closing. Opcional."
        >
          <TextAreaField
            label="Reglas de urgencia"
            value={config.urgency_rules ?? ""}
            error={issueAt("urgency_rules")}
            placeholder="Si el colegio empieza en menos de 30 días,ukaupar la agenda."
            onChange={(v) => patch("urgency_rules", v === "" ? null : v)}
          />
        </BlockSection>

        {/* ================= Notas del draft ========================= */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="pb-draft-notes">
            Comentario del draft
          </label>
          <textarea
            id="pb-draft-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Qué estás cambiando en este draft (opcional)."
            className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* ================= Barra de acciones ======================= */}
        {hasErrors ? (
          <div
            className="rounded-md border border-danger-border bg-danger-soft px-3 py-2"
            role="alert"
          >
            <p className="text-sm font-medium text-danger-text">
              {allIssues.length}{" "}
              {allIssues.length === 1 ? "problema" : "problemas"} por resolver
              {checking ? " · validando…" : ""}
            </p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-xs text-danger-text">
              {allIssues.slice(0, 6).map((issue, i) => (
                <li key={`${issue.path}-${i}`}>
                  {issue.path ? <code className="opacity-80">{issue.path}</code> : null}{" "}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            onClick={handleSave}
            disabled={saving || publishing || !dirty}
            title={dirty ? undefined : "No hay cambios que guardar"}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button variant="outline" onClick={onDiscard} disabled={saving || publishing}>
            Descartar cambios
          </Button>
          <Button
            variant="secondary"
            onClick={onPublish}
            disabled={hasErrors || saving || publishing}
            title={hasErrors ? "Corrige los errores antes de publicar" : undefined}
          >
            {publishing ? "Publicando…" : "Publicar"}
          </Button>
          {canDelete ? (
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={deleting || saving || publishing}
              className="ml-auto"
            >
              {deleting ? "Eliminando…" : "Eliminar draft"}
            </Button>
          ) : null}
          {!canDelete ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Para eliminar el draft hace falta una versión publicada activa.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
