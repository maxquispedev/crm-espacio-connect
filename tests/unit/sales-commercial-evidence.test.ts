import { describe, expect, it } from "vitest";
import { withAttendanceKnowledge, withCommercialEvidenceQuestions, commercialEvidenceHandoff } from "@/server/sales/commercial-evidence";
import { VENDE_VELOZ_PRODUCT } from "@/server/sales/vende-veloz";
import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import { SalesWriterOutput } from "@/server/sales/writer";
import { BASE_FACTS, makeDecision } from "./sales-fixtures";

describe("016 — contrato de evidencia", () => {
  it("Published antigua recibe asistencia sin alterar prioridades ni otros productos", () => {
    const old = { ...VENDE_VELOZ_PRODUCT, core_jobs: ["Alumnos"] } as unknown as typeof VENDE_VELOZ_PRODUCT;
    expect(withAttendanceKnowledge(old).core_jobs.join(" ")).toContain("control/consumo de sesiones");
    expect(withAttendanceKnowledge(old).core_jobs.join(" ")).toContain("Búsqueda por DNI, nombre o apellido");
    expect(old.core_jobs).toEqual(["Alumnos"]);
    const other = { ...old, name: "Otro producto" } as unknown as typeof VENDE_VELOZ_PRODUCT;
    expect(withAttendanceKnowledge(other)).toBe(other);
    expect(VENDE_VELOZ_PLAYBOOK_V1.priorities.tertiary).toContain("Asistencia y sesiones");
    expect(VENDE_VELOZ_PLAYBOOK_V1.priorities.primary.join(" ")).not.toContain("Asistencia");
  });
  it("runtime refuerza Jev sin mutar upstream ni opciones/tipos", () => {
    const frozen = JSON.stringify(JEV_SALES_QUESTIONS_V2);
    const effective = withCommercialEvidenceQuestions(JEV_SALES_QUESTIONS_V2);
    expect(effective.next_action!.instructions).toContain("HANDOFF HUMANO SILENCIOSO");
    expect(effective.needs_human_call!.instructions).toContain("ask_more_questions");
    expect(effective.next_action!.criteria).toEqual(JEV_SALES_QUESTIONS_V2.next_action.criteria);
    expect(JSON.stringify(JEV_SALES_QUESTIONS_V2)).toBe(frozen);
  });
  it("unknown revoca demo/precio/follow-up y preserva protección de won", () => {
    const plan = resolveSalesPlan({ decision: makeDecision({ nextAction: "schedule_follow_up" }), currentSalesState: BASE_FACTS, currentPipelineStage: "won" });
    expect(commercialEvidenceHandoff(plan, "unknown")).toMatchObject({ lane: "human", nextAction: "schedule_call", shouldReply: false, shouldHandoff: true, desiredPipelineSemantic: null, factUpdates: {}, followUpDirective: { kind: "none" } });
  });
  it("clasificación ausente falla cerrado y estado inventado no pasa schema", () => {
    expect(SalesWriterOutput.parse({ text: "Sí, se integra" }).commercial_evidence).toBe("unknown");
    expect(SalesWriterOutput.safeParse({ commercial_evidence: "creo", text: "Sí" }).success).toBe(false);
  });
});
