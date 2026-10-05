import { withCommercialEvidenceQuestions } from "@/server/sales/commercial-evidence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import * as env from "@/lib/env";

import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import { makeDecision } from "./sales-fixtures";

const evaluateJev = vi.hoisted(() => vi.fn());
const writeSalesReply = vi.hoisted(() => vi.fn());
const deliverReply = vi.hoisted(() => vi.fn());
const applyHandoff = vi.hoisted(() => vi.fn());
const scheduleNextFollowUp = vi.hoisted(() => vi.fn());
const scopedSpy = vi.hoisted(() => vi.fn());
const getPublishedConfigForOrg = vi.hoisted(() => vi.fn());

vi.mock("@/server/sales/client", () => ({ evaluateJev }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply }));
vi.mock("@/server/ai/delivery", () => ({ applyHandoff, deliverReply }));
vi.mock("@/server/sales/follow-ups/store", () => ({ scheduleNextFollowUp }));
vi.mock("@/lib/db/tenant", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/tenant")>();
  return { ...real, scoped: (...args: Parameters<typeof real.scoped>) => {
    scopedSpy(...args);
    return real.scoped(...args);
  } };
});
vi.mock("@/lib/sales/playbook/loader", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sales/playbook/loader")>();
  return { ...real, getPublishedConfigForOrg };
});

const selectQueue: unknown[][] = [];
const leadPatches: Array<Record<string, unknown>> = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        leadPatches.push(patch);
        return {
          where: () => ({
            then: (resolve: (v: unknown) => void) => Promise.resolve([]).then(resolve),
            returning: () => Promise.resolve([]),
          }),
        };
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

const STAGES = [
  { id: "st_new", name: "Nuevo", kind: "open" },
  { id: "st_chat", name: "En conversación", kind: "open" },
  { id: "st_int", name: "Interesado", kind: "open" },
  { id: "st_won", name: "Cliente", kind: "won" },
  { id: "st_lost", name: "Perdido", kind: "lost" },
];

const LEAD = {
  id: "ld_1",
  organizationId: "org_1",
  contactId: "ct_1",
  stageId: "st_new",
  automationLane: "auto",
  demoShownAt: null,
  pricePresentedAt: null,
  paymentInstructionsSentAt: null,
  humanRequestedAt: null,
  followUpCount: 0,
};

const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: false,
  aiEnabled: true,
  handoffAt: null,
};

beforeEach(() => {
  evaluateJev.mockReset();
  writeSalesReply.mockReset();
  deliverReply.mockReset();
  applyHandoff.mockReset();
  scheduleNextFollowUp.mockReset();
  scopedSpy.mockClear();
  getPublishedConfigForOrg.mockReset();
  selectQueue.length = 0;
  leadPatches.length = 0;
});


import { VENDE_VELOZ_PRODUCT, VENDE_VELOZ_COMMERCIAL_POLICY, VENDE_VELOZ_OFFER } from "@/server/sales/vende-veloz";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import { buildJevSalesState, SALES_PLAYBOOK_RUNTIME_ENABLED } from "@/server/sales/build-state";

function queueTurn(orgId: string, conversationId: string) {
  const conv = { ...CONVERSATION, id: conversationId, organizationId: orgId };
  const lead = { ...LEAD, organizationId: orgId, stageId: "st_int" };
  selectQueue.push(
    [{ conversation: conv, contact: { id: "ct_1" } }],
    [{ lead, stageName: "Interesado" }],
    [{ message: { direction: "in", text: "precio por favor" }, media: null }],
    [{ sourceType: "ad", headline: "Ordena tu academia", body: "Control de pagos" }],
    [{ lead, stage: STAGES[2] }],
    [], // KB disponible antes de Jev
    [{ tone: "cercano", instructions: "Sé breve", escalationRules: "Pedido humano" }],
    STAGES,
  );
  return conv;
}

/**
 * Versión publicada REALISTA: el loader siempre entrega un `ConfigV1`
 * completo y validado por `parseConfigV1` (`src/lib/sales/playbook/loader.ts`),
 * así que la fixture cubre los 6 campos de `product` y los 9 de
 * `commercial_policy` (camelCase, el contrato durable).
 */
function published(version: number) {
  return {
    id: `spv_${version}`, schema_version: "1.0.0", version_number: version,
    status: "published",
    config: {
      product: {
        name: `Producto publicado ${version}`,
        one_liner: `One liner publicado ${version}`,
        who_it_is_for: [`Audience ${version}`],
        core_jobs: [`Job ${version}`],
        not_the_product: [`No es X ${version}`],
        how_it_starts: `Arranque publicado ${version}`,
      },
      commercial_policy: {
        defaultChannel: "WhatsApp",
        goal: "POLICY CUSTOM",
        automationFirst: `AUTOMATION ${version}`,
        autoClose: `AUTOCLOSE ${version}`,
        humanHandoff: `HANDOFF ${version}`,
        futureInterest: `FUTURE ${version}`,
        noResponse: `NORES ${version}`,
        disqualification: "DISQUAL CUSTOM",
        evidenceRule: `EVIDENCE ${version}`,
      },
      offer: { setup: 9999 },
      writer: { present_price: "WRITER CUSTOM" },
      jev_questions: { custom_question: { type: "score", instructions: "CUSTOM" } },
    },
  };
}

describe("lanzamiento: builder + orquestador + resolver reales", () => {
  it("turno production-like usa cliente HTTP real sin 422 por criteria; falla seguro si Jev rechaza", async () => {
    const received: unknown[] = [];
    let reject = false;
    const provider = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      received.push(payload.questions);
      const invalid = Object.values(payload.questions).some((q) => {
        const question = q as { type: string; criteria: unknown };
        return question.type === "score" && !Array.isArray(question.criteria);
      });
      res.setHeader("content-type", "application/json");
      if (invalid || reject) {
        res.statusCode = 422;
        res.end(JSON.stringify({ detail: [{ loc: ["body", "questions", "product_fit", "score", "criteria"], msg: "Input should be a valid list" }] }));
      } else {
        res.end(JSON.stringify({ answers: {
          next_action: { type: "choice", choice: "present_price" },
          needs_human_call: { type: "noul", noul: 0.1 },
        } }));
      }
    });
    try {
      await new Promise<void>((resolve, rejectListen) => {
        provider.once("error", rejectListen);
        provider.listen(0, "127.0.0.1", resolve);
      });
      const address = provider.address();
      if (!address || typeof address === "string") throw new Error("Puerto local ausente");
      // Config sintética del adaptador: no lee ni modifica variables/secretos.
      vi.spyOn(env, "isJevConfigured").mockReturnValue(true);
      vi.spyOn(env, "getEnv").mockReturnValue({
        APP_BASE_URL: "http://localhost:3000", DATABASE_URL: "postgresql://test:test@localhost/test",
        BETTER_AUTH_SECRET: "local-test-placeholder", ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
        META_WEBHOOK_VERIFY_TOKEN: "local-test", META_GRAPH_API_VERSION: "v25.0",
        META_GRAPH_BASE_URL: "http://localhost", OPENROUTER_BASE_URL: "http://localhost",
        AGENT_COALESCE_MS: 0, MEDIA_DIR: "/tmp", NODE_ENV: "test",
        TYPESAFE_API_KEY: "synthetic-test", TYPESAFE_JEV_ENDPOINT: `http://127.0.0.1:${address.port}/jev`, JEV_MODEL: "local-jev",
      });
      const client = await vi.importActual<typeof import("@/server/sales/client")>("@/server/sales/client");
      evaluateJev.mockImplementation(client.evaluateJev);
      writeSalesReply.mockResolvedValue({ ok: true, text: "Oferta conocida" });
      deliverReply.mockResolvedValue(true);
      const conv = queueTurn("org_1", "cv_http");
      await runSalesOrchestratorTurn({ organizationId: "org_1", conversationId: conv.id, conversation: conv as never });
      expect(received).toEqual([withCommercialEvidenceQuestions(JEV_SALES_QUESTIONS_V2)]);
      expect(deliverReply).toHaveBeenCalledOnce();
      expect(leadPatches.some(p => p.automationLane === "auto_close")).toBe(true);

      reject = true;
      const failed = queueTurn("org_1", "cv_http_rejected");
      await runSalesOrchestratorTurn({ organizationId: "org_1", conversationId: failed.id, conversation: failed as never });
      expect(received).toEqual([withCommercialEvidenceQuestions(JEV_SALES_QUESTIONS_V2), withCommercialEvidenceQuestions(JEV_SALES_QUESTIONS_V2)]);
      expect(deliverReply).toHaveBeenCalledOnce();
      expect(leadPatches.at(-1)?.lastJevError).toContain("422");
    } finally {
      vi.restoreAllMocks();
      provider.closeAllConnections();
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
  });

  it("la Published de la org ALIMENTA el turno real y su versión se audita", async () => {
    evaluateJev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "present_price" }), snapshot: {} });
    writeSalesReply.mockResolvedValue({ ok: true, text: "Oferta conocida" });
    deliverReply.mockResolvedValue(true);
    for (const [orgId, version] of [["org_1", 1], ["org_1", 2], ["org_2", 3]] as const) {
      getPublishedConfigForOrg.mockResolvedValue(published(version));
      const conversationId = `cv_${version}`;
      const conv = queueTurn(orgId, conversationId);
      await runSalesOrchestratorTurn({ organizationId: orgId, conversationId, conversation: conv as never });
      expect(selectQueue).toHaveLength(0);

      // T933 (invertido): la Published SE USA. El loader se invoca una
      // vez por turno, con la org de la conversación.
      expect(getPublishedConfigForOrg).toHaveBeenCalledWith(orgId);

      // El state ya no es el default: product y commercial_policy
      // vienen del playbook publicado.
      const input = evaluateJev.mock.calls.at(-1)![0];
      expect(input.state.product).toMatchObject({ name: `Producto publicado ${version}` });
      expect(input.state.commercial_policy).toMatchObject({ goal: "POLICY CUSTOM" });
      // El resto de la política publicada llega mapeado a snake_case
      // (T932): el spread shallow la habría perdido en silencio.
      expect(input.state.commercial_policy).toMatchObject({
        default_channel: "WhatsApp",
        goal: "POLICY CUSTOM",
        automation_first: `AUTOMATION ${version}`,
        auto_close: `AUTOCLOSE ${version}`,
        human_handoff: `HANDOFF ${version}`,
        future_interest: `FUTURE ${version}`,
        no_response: `NORES ${version}`,
        disqualification: "DISQUAL CUSTOM",
        evidence_rule: expect.stringContaining(`EVIDENCE ${version}`),
      });
      // Y el state NO arrastra `implementation`/`subscription`
      // hardcodeados de Vende Veloz (T932).
      expect(input.state.product.implementation).toBeUndefined();
      expect(input.state.product.subscription).toBeUndefined();
      // El contexto NO playbook se conserva intacto.
      expect(input.state.source).toBe("Meta Ads");
      expect(input.state.ad_context).toEqual({ source_type: "ad", headline: "Ordena tu academia", body: "Control de pagos" });

      // offer y writer instrucciones también vienen del playbook.
      expect(writeSalesReply).toHaveBeenLastCalledWith(expect.objectContaining({
        product: expect.objectContaining({ name: `Producto publicado ${version}` }),
        offer: expect.objectContaining({ setup: 9999 }),
        writerInstructions: expect.objectContaining({ present_price: "WRITER CUSTOM" }),
        plan: expect.objectContaining({ lane: "auto_close", nextAction: "present_price" }),
        agentProfile: { tone: "cercano", instructions: "Sé breve", escalationRules: "Pedido humano" },
      }));
      // Las preguntas Jev salen del playbook publicado.
      expect(Object.keys(input.questions)).toContain("custom_question");
      expect(input.questions.custom_question).toMatchObject({ type: "score", instructions: "CUSTOM" });

      expect(deliverReply).toHaveBeenLastCalledWith(conv, "Oferta conocida");
      expect(scheduleNextFollowUp).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: orgId, conversationId, leadId: "ld_1" }));

      // T933 (invertido): la versión usada SE AUDITA en lead y decision.
      const patch = leadPatches.at(-2);
      expect(patch).toMatchObject({
        automationLane: "auto_close",
        lastJevPlaybookVersionId: `spv_${version}`,
        lastJevPlaybookSchemaVersion: "1.0.0",
        lastJevDecision: expect.objectContaining({
          playbook_version_id: `spv_${version}`,
          playbook_schema_version: "1.0.0",
          playbook_version_number: version,
        }),
      });
      expect(leadPatches.at(-1)?.pricePresentedAt).toBeInstanceOf(Date);
      // Tenant-safe: toda query del turno cerró por su propia org.
      expect(scopedSpy.mock.calls.every((args) => args[1] === orgId)).toBe(true);
      scopedSpy.mockClear();
    }
    expect(getPublishedConfigForOrg).toHaveBeenCalledTimes(3);
    expect(applyHandoff).not.toHaveBeenCalled();
  });

  it("sin Published degradable: fallback hardcodeado, sin crash y SIN auditar versión", async () => {
    evaluateJev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "present_price" }), snapshot: {} });
    writeSalesReply.mockResolvedValue({ ok: true, text: "Oferta conocida" });
    deliverReply.mockResolvedValue(true);
    // Published ausente.
    getPublishedConfigForOrg.mockResolvedValue(null);
    const conv = queueTurn("org_1", "cv_sin_playbook");
    await expect(runSalesOrchestratorTurn({
      organizationId: "org_1", conversationId: conv.id, conversation: conv as never,
    })).resolves.toBeUndefined();

    // Cae al baseline hardcodeado…
    expect(evaluateJev).toHaveBeenLastCalledWith({
      state: expect.objectContaining({
        product: VENDE_VELOZ_PRODUCT, commercial_policy: expect.objectContaining({ evidence_rule: expect.stringContaining(VENDE_VELOZ_COMMERCIAL_POLICY.evidence_rule) }),
      }),
      questions: withCommercialEvidenceQuestions(JEV_SALES_QUESTIONS_V2),
    });
    // …y no inventa una versión auditada.
    const patch = leadPatches.find((p) => "lastJevPlaybookVersionId" in p);
    expect(patch).toMatchObject({
      lastJevPlaybookVersionId: null,
      lastJevPlaybookSchemaVersion: null,
      lastJevDecision: expect.objectContaining({ playbook_version_id: null, playbook_schema_version: null, playbook_version_number: null }),
    });
    expect(deliverReply).toHaveBeenCalledOnce();

    // Published INVÁLIDA (falla ConfigV1 en el loader): degrada igual.
    const { __resetWarnedNoPlaybookOrgs } = await import("@/server/sales/build-state");
    const { PlaybookInvalidConfigError } = await import("@/lib/sales/playbook/loader");
    __resetWarnedNoPlaybookOrgs();
    evaluateJev.mockClear();
    writeSalesReply.mockClear();
    getPublishedConfigForOrg.mockRejectedValue(new PlaybookInvalidConfigError("rota"));
    const conv2 = queueTurn("org_1", "cv_playbook_roto");
    await expect(runSalesOrchestratorTurn({
      organizationId: "org_1", conversationId: conv2.id, conversation: conv2 as never,
    })).resolves.toBeUndefined();
    expect(evaluateJev).toHaveBeenCalledOnce();
    const input = evaluateJev.mock.calls.at(-1)![0];
    expect(input.state.product).toEqual(VENDE_VELOZ_PRODUCT);
    expect(input.state.commercial_policy).toMatchObject({ ...VENDE_VELOZ_COMMERCIAL_POLICY, evidence_rule: expect.stringContaining(VENDE_VELOZ_COMMERCIAL_POLICY.evidence_rule) });
    expect(input.questions).toEqual(withCommercialEvidenceQuestions(JEV_SALES_QUESTIONS_V2));
    __resetWarnedNoPlaybookOrgs();
  });

  it("tenant sin conversación accesible retorna not_found sin Jev, writer ni efectos", async () => {
    selectQueue.push([]);
    const result = await buildJevSalesState({ organizationId: "org_other", conversationId: "cv_1" });
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(scopedSpy).toHaveBeenCalledWith(expect.anything(), "org_other", expect.anything());
    // No se consulta la Published de ninguna org si no hay conversación.
    expect(getPublishedConfigForOrg).not.toHaveBeenCalled();
    expect(evaluateJev).not.toHaveBeenCalled();
    expect(writeSalesReply).not.toHaveBeenCalled();
    expect(leadPatches).toHaveLength(0);
  });
});

/**
 * T933 (corte 3, spec 009) — inversión de la regresión de congelamiento.
 *
 * El corte 2 dejó el runtime en `false` y este archivo lo fijaba. El
 * corte 3 ENCIENDE `SALES_PLAYBOOK_RUNTIME_ENABLED`, así que la
 * aserción se invierte: el loader publicado **sí** se invoca en
 * conversaciones reales y la versión usada **sí** se audita.
 *
 * `hardcoded` deja de ser la única fuente: pasa a ser el **fallback**
 * cuando no hay Published o la Published es inválida.
 */
describe("runtime publicado en producción — el corte 3 ENCIENDE el runtime", () => {
  it("SALES_PLAYBOOK_RUNTIME_ENABLED está en true (reversible en una línea)", () => {
    expect(SALES_PLAYBOOK_RUNTIME_ENABLED).toBe(true);
  });

  it("el baseline comercial sigue intacto como fallback", () => {
    expect(VENDE_VELOZ_OFFER.setup).toBe(0);
    expect(VENDE_VELOZ_OFFER.monthlyBase).toBe(247);
    expect(VENDE_VELOZ_OFFER.includedActiveStudents).toBe(50);
    expect(VENDE_VELOZ_OFFER.extraPerActiveStudent).toBe(1);
  });
});
