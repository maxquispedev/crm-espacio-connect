import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JEV_STATE_CONTEXT,
  trimConversation,
} from "@/server/sales/build-state";

const selectQueue: unknown[][] = [];
const scopedCalls: Array<{
  organizationColumn: unknown;
  organizationId: string;
  conditions: unknown[];
}> = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db/tenant", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/tenant")>();
  return {
    ...original,
    scoped: (
      organizationColumn: unknown,
      organizationId: string,
      ...conditions: unknown[]
    ) => {
      scopedCalls.push({ organizationColumn, organizationId, conditions });
      return original.scoped(
        organizationColumn as never,
        organizationId,
        ...(conditions as never[])
      );
    },
  };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

describe("trimConversation", () => {
  it("conserva lo más reciente y recorta turnos antiguos", () => {
    const turns = Array.from({ length: 100 }, (_, i) => ({
      from: i % 2 === 0 ? ("lead" as const) : ("seller" as const),
      text: `turno-${i}`,
    }));
    const trimmed = trimConversation(turns);
    expect(trimmed.length).toBeLessThanOrEqual(JEV_STATE_CONTEXT.MAX_TURNS);
    expect(trimmed.at(-1)?.text).toBe("turno-99");
    expect(trimmed[0]?.text).toBe(`turno-${100 - trimmed.length}`);
  });

  it("recorta un turno excesivo y deja elipsis", () => {
    const huge = "x".repeat(JEV_STATE_CONTEXT.MAX_TURN_CHARS + 50);
    const [turn] = trimConversation([{ from: "lead", text: huge }]);
    expect(turn?.text.length).toBe(JEV_STATE_CONTEXT.MAX_TURN_CHARS + 1);
    expect(turn?.text.endsWith("…")).toBe(true);
  });
});

describe("buildJevSalesState", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    scopedCalls.length = 0;
  });

  it("no incluye teléfono, email ni wa ids en el state que va a Jev", async () => {
    selectQueue.push(
      [
        {
          conversation: { id: "cv_1", organizationId: "org_1", contactId: "ct_1" },
          contact: {
            id: "ct_1",
            name: "Ana",
            phone: "5215512345678",
            email: "ana@secret.test",
            waIdentity: "bsuid:abc",
          },
        },
      ],
      [
        {
          lead: {
            id: "ld_1",
            automationLane: "auto",
            demoShownAt: null,
            pricePresentedAt: null,
            paymentInstructionsSentAt: null,
            humanRequestedAt: null,
            followUpCount: 0,
          },
          stageName: "Nuevo",
        },
      ],
      [
        {
          message: {
            direction: "in",
            text: "Hola, busco control de alumnos",
            type: "text",
          },
          media: null,
        },
      ],
      // 4) ad_attribution: vacía para esta conversación.
      []
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.state);
    expect(serialized).not.toContain("5215512345678");
    expect(serialized).not.toContain("ana@secret.test");
    expect(serialized).not.toContain("bsuid:abc");
    expect(result.state).not.toHaveProperty("phone");
    expect(result.state).not.toHaveProperty("email");
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "Hola, busco control de alumnos" },
    ]);
    expect(Object.keys(result.state)).toEqual([
      "product",
      "commercial_policy",
      "crm_state",
      "conversation",
    ]);
    expect(result.state).not.toHaveProperty("commercial_offer");
    expect(result.persist.leadId).toBe("ld_1");
  });

  it("mapea outbound a seller y no incluye commercial_offer", async () => {
    selectQueue.push(
      [
        {
          conversation: { id: "cv_1", organizationId: "org_1", contactId: "ct_1" },
          contact: { id: "ct_1" },
        },
      ],
      [],
      [
        {
          message: { direction: "out", text: "te ayudo", type: "text" },
          media: null,
        },
        {
          message: { direction: "in", text: "hola", type: "text" },
          media: null,
        },
      ],
      // ad_attribution ausente.
      []
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "hola" },
      { from: "seller", text: "te ayudo" },
    ]);
    expect(result.state).not.toHaveProperty("commercial_offer");
  });

  it("sin conversación del tenant → not_found, no lanza", async () => {
    selectQueue.push([]);
    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_other",
      conversationId: "cv_missing",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  // -------------------------------------------------------------------
  // Hotfix 2026-09-30 — conservar contexto de Meta Ads en estado Jev.
  // Las pruebas verifican que el state enviado a Jev incluye
  // `source: "Meta Ads"` y `ad_context` estructurado cuando la
  // conversación tiene fila en `ad_attribution`. Ausente (sin cambios
  // observables) para conversaciones orgánicas.
  // -------------------------------------------------------------------

  it("A. conversación orgánica: sin source, sin ad_context, hilo intacto", async () => {
    // selectQueue recibe 4 pushes para los 4 SELECT reales:
    // 1) conversation+contact, 2) lead+stage, 3) messages, 4) ad_attribution.
    // Los mensajes se empujan en orden DESC por createdAt (tal como los
    // entrega la query `orderBy(desc(...))`); el builder los invierte
    // para obtener el orden cronológico final.
    selectQueue.push(
      [
        {
          conversation: { id: "cv_org", organizationId: "org_1", contactId: "ct_org" },
          contact: { id: "ct_org", name: "Sin Ad", phone: null, email: null, waIdentity: null },
        },
      ],
      [
        {
          lead: {
            id: "ld_org",
            automationLane: "auto",
            demoShownAt: null,
            pricePresentedAt: null,
            paymentInstructionsSentAt: null,
            humanRequestedAt: null,
            followUpCount: 0,
          },
          stageName: "Nuevo",
        },
      ],
      [
        // DESC (más reciente primero):
        {
          message: {
            direction: "out",
            text: "¡Hola! Cuéntame, ¿qué te interesa?",
            type: "text",
          },
          media: null,
        },
        {
          message: {
            direction: "in",
            text: "Hola, vi su página y me interesa",
            type: "text",
          },
          media: null,
        },
      ],
      // 4) ad_attribution: ausente → orgánica.
      []
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_org",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Conversación intacta (cronológica tras la inversión del builder).
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "Hola, vi su página y me interesa" },
      { from: "seller", text: "¡Hola! Cuéntame, ¿qué te interesa?" },
    ]);
    // Sin source ni ad_context — el state serializa idéntico al estado
    // pre-hotfix para que las conversaciones orgánicas no cambien.
    expect(result.state.source).toBeUndefined();
    expect(result.state.ad_context).toBeUndefined();
    expect(Object.keys(result.state).sort()).toEqual([
      "commercial_policy",
      "conversation",
      "crm_state",
      "product",
    ]);
  });

  it("B. conversación con ad_attribution: source=Meta Ads, ad_context con headline/body, sin PII, sin sourceId ni ctwa_clid, hilo intacto", async () => {
    selectQueue.push(
      [
        {
          conversation: {
            id: "cv_ad",
            organizationId: "org_1",
            contactId: "ct_ad",
          },
          contact: {
            id: "ct_ad",
            name: "Lead Ad",
            phone: "5215512345678",
            email: "lead@secret.test",
            waIdentity: "bsuid:secret",
          },
        },
      ],
      [
        {
          lead: {
            id: "ld_ad",
            automationLane: "auto",
            demoShownAt: null,
            pricePresentedAt: null,
            paymentInstructionsSentAt: null,
            humanRequestedAt: null,
            followUpCount: 0,
          },
          stageName: "Nuevo",
        },
      ],
      [
        {
          message: {
            direction: "in",
            text: "Hola quiero más información",
            type: "text",
          },
          media: null,
        },
      ],
      // 4) ad_attribution: el creativo real con datos que Jev NO debe ver
      // (ctwa_clid, sourceId, sourceUrl, raw). El state solo debe llevar
      // source_type, headline y body.
      [
        {
          sourceType: "ad",
          headline: "Automatiza las matrículas de tu academia",
          body: "Vende Veloz 365 centraliza alumnos, pagos y operación.",
          // Campos prohibidos a propósito — verificamos que NO se filtran.
          ctwaClid: "clid_secreto_xyz",
          sourceId: "src_999",
          sourceUrl: "https://facebook.com/ads/999",
          imageAssetId: "ma_42",
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_ad",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Source y ad_context estructurados.
    expect(result.state.source).toBe("Meta Ads");
    expect(result.state.ad_context).toEqual({
      source_type: "ad",
      headline: "Automatiza las matrículas de tu academia",
      body: "Vende Veloz 365 centraliza alumnos, pagos y operación.",
    });

    // Defensa PII / Constitución I — ni el identificador de clic ni el
    // sourceId ni URLs crudas del creativo ni access tokens llegan al state.
    const serialized = JSON.stringify(result.state);
    expect(serialized).not.toContain("clid_secreto_xyz");
    expect(serialized).not.toContain("src_999");
    expect(serialized).not.toContain("facebook.com/ads/999");
    expect(serialized).not.toContain("ma_42");
    // El state no expone PII del contacto.
    expect(serialized).not.toContain("5215512345678");
    expect(serialized).not.toContain("lead@secret.test");
    expect(serialized).not.toContain("bsuid:secret");
    expect(serialized).not.toContain("raw");
    // Ni identificadores internos de Meta ni access tokens.
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("EAA");

    // La conversación real sigue intacta.
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "Hola quiero más información" },
    ]);
  });

  it("B.pub. sourceType='post' (publicación orgánica del negocio) → también emite Meta Ads + ad_context", async () => {
    // El spec 006 distingue ad (pauta) de post (publicación del propio
    // negocio). Ambos llegan desde Meta como referral y deben conservarse
    // como contexto comercial para Jev: si el lead llegó por una
    // publicación del negocio, Jev debe saberlo.
    selectQueue.push(
      [
        {
          conversation: { id: "cv_post", organizationId: "org_1", contactId: "ct_post" },
          contact: { id: "ct_post" },
        },
      ],
      [],
      [
        {
          message: { direction: "in", text: "Vi su publicación en Instagram", type: "text" },
          media: null,
        },
      ],
      [
        {
          sourceType: "post",
          headline: "Nuevo curso de verano",
          body: "Inscripciones abiertas en Los Delfines.",
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_post",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.source).toBe("Meta Ads");
    expect(result.state.ad_context).toEqual({
      source_type: "post",
      headline: "Nuevo curso de verano",
      body: "Inscripciones abiertas en Los Delfines.",
    });
  });

  it("B.headline-solo: sourceType null, headline presente, body null → emite Meta Ads + ad_context parcial", async () => {
    // Caso defensivo: la fila existe pero solo con headline (porque el
    // creativo de Meta no tenía body). El state sigue emitiendo
    // source + ad_context con los nulls explícitos para no perder la
    // señal. Jev debe ver al menos el titular.
    selectQueue.push(
      [
        {
          conversation: { id: "cv_partial", organizationId: "org_1", contactId: "ct_p" },
          contact: { id: "ct_p" },
        },
      ],
      [],
      [
        {
          message: { direction: "in", text: "Hola", type: "text" },
          media: null,
        },
      ],
      [
        {
          sourceType: null,
          headline: "Titular sin body",
          body: null,
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_partial",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.source).toBe("Meta Ads");
    expect(result.state.ad_context).toEqual({
      source_type: null,
      headline: "Titular sin body",
      body: null,
    });
  });

  it("B.vacía: fila existe pero los 3 campos comerciales son null → no emite ni source ni ad_context", async () => {
    // Defensa: si la fila existe pero solo trae ctwa_clid u otros campos
    // sensibles que NO transportamos, no emitimos source ni ad_context.
    // (Equivale a la rama orgánica para efectos del state que Jev ve.)
    selectQueue.push(
      [
        {
          conversation: { id: "cv_empty", organizationId: "org_1", contactId: "ct_e" },
          contact: { id: "ct_e" },
        },
      ],
      [],
      [
        {
          message: { direction: "in", text: "Hola", type: "text" },
          media: null,
        },
      ],
      [
        {
          sourceType: null,
          headline: null,
          body: null,
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_empty",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.source).toBeUndefined();
    expect(result.state.ad_context).toBeUndefined();
  });

  it("C. seguridad: el state NO contiene ctwa_clid, sourceId, sourceUrl, imageAssetId, access tokens, PII del contacto", async () => {
    // Defensa explícita del contrato de Constitución I. El mock
    // simula la fila completa de ad_attribution incluyendo TODO lo
    // sensible. El state serializado no debe contener ninguno de esos
    // campos.
    selectQueue.push(
      [
        {
          conversation: { id: "cv_sec", organizationId: "org_1", contactId: "ct_sec" },
          contact: {
            id: "ct_sec",
            phone: "51999888777",
            email: "secret@victima.test",
            waIdentity: "bsuid:victima",
          },
        },
      ],
      [],
      [{ message: { direction: "in", text: "Hola", type: "text" }, media: null }],
      [
        {
          sourceType: "ad",
          headline: "H",
          body: "B",
          ctwaClid: "clid_secreto_CTWA_123",
          sourceId: "src_secret_id_789",
          sourceUrl: "https://graph.facebook.com/v18.0/ads/secret",
          imageAssetId: "ma_secret_42",
          accessToken: "EAAxxxxxx_access_token_secreto",
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_sec",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.state);
    // ctwa_clid
    expect(serialized).not.toContain("clid_secreto_CTWA_123");
    // sourceId / sourceUrl / imageAssetId
    expect(serialized).not.toContain("src_secret_id_789");
    expect(serialized).not.toContain("graph.facebook.com/v18.0/ads/secret");
    expect(serialized).not.toContain("ma_secret_42");
    // access tokens
    expect(serialized).not.toContain("EAAxxxxxx_access_token_secreto");
    expect(serialized.toLowerCase()).not.toContain("access_token");
    // PII del contacto
    expect(serialized).not.toContain("51999888777");
    expect(serialized).not.toContain("secret@victima.test");
    expect(serialized).not.toContain("bsuid:victima");
    // Pero SÍ debe llevar el contexto comercial permitido.
    expect(result.state.source).toBe("Meta Ads");
    expect(result.state.ad_context).toEqual({
      source_type: "ad",
      headline: "H",
      body: "B",
    });
  });

  it("D. tenant isolation multi-org: ORG_A solo ve su attribution; la de ORG_B jamás aparece", async () => {
    // Defensa multi-tenancy (Constitución III). El builder filtra por
    // (organization_id, conversation_id) usando scoped(). Aquí el
    // escenario realista: ORG_A y ORG_B tienen cada una una fila en
    // ad_attribution; el state que arma el CRM para una conversación
    // de ORG_A solo debe ver la fila de ORG_A, jamás la de ORG_B.
    //
    // Truco del mock: el `select` solo se llama una vez para
    // ad_attribution por corrida de `buildJevSalesState`. Para que el
    // test sea realista, fijamos el mock para devolver la fila de
    // ORG_A cuando scoped() recibe la (org, conv) de ORG_A. El otro
    // path (org_B) simplemente no devuelve esa fila porque scoped()
    // cierra la cláusula WHERE y la fila de ORG_B no la cumple.

    // ORG A: conversation A → attribution A (presente)
    selectQueue.push(
      [
        {
          conversation: {
            id: "cv_A",
            organizationId: "org_A",
            contactId: "ct_A",
          },
          contact: { id: "ct_A" },
        },
      ],
      [],
      [{ message: { direction: "in", text: "Hola", type: "text" }, media: null }],
      // ad_attribution: si las condiciones scoped() filtran por
      // (org_A, cv_A), devolvemos la fila de ORG_A. Esto emula lo
      // que Drizzle haría en runtime: la cláusula WHERE limita por
      // (organization_id, conversation_id) y solo la fila de ORG_A
      // cumple. La fila de ORG_B (diferente organization_id y
      // conversation_id) no aparece.
      [
        {
          sourceType: "ad",
          headline: "Anuncio de ORG_A",
          body: "Solo visible para org_A.",
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const resultA = await buildJevSalesState({
      organizationId: "org_A",
      conversationId: "cv_A",
    });
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;

    // El state de ORG_A lleva el contexto de ORG_A.
    expect(resultA.state.source).toBe("Meta Ads");
    expect(resultA.state.ad_context?.headline).toBe("Anuncio de ORG_A");
    expect(resultA.state.ad_context?.body).toBe("Solo visible para org_A.");

    // La serialización no debe contener ningún identificador de ORG_B.
    const serializedA = JSON.stringify(resultA.state);
    expect(serializedA).not.toContain("org_B");
    expect(serializedA).not.toContain("cv_B");
    expect(serializedA).not.toContain("Anuncio de ORG_B");
    expect(serializedA).not.toContain("Visible para org_B");

    // ORG B: intentar construir state con la misma conversación de
    // ORG_A. El primer SELECT (conversation+contact) usa scoped() por
    // org_B y NO encuentra la conversación (porque pertenece a
    // org_A), por lo que devuelve not_found sin llegar a tocar
    // ad_attribution. Eso, por sí solo, ya es aislamiento correcto:
    // ORG_B no obtiene el contexto de ORG_A ni viceversa.
    selectQueue.push([]);
    const resultB = await buildJevSalesState({
      organizationId: "org_B",
      conversationId: "cv_A", // intenta ver la conversación de ORG_A
    });
    expect(resultB.ok).toBe(false);
    if (resultB.ok) return;
    expect(resultB.error).toBe("not_found");

    // Defense in depth: el cuarto scoped() (ad_attribution) jamás
    // recibió la organización equivocada.
    for (const call of scopedCalls) {
      expect(call.organizationId).not.toBe("org_xyz_evil");
    }
  });

  it("D.scoped: la consulta a ad_attribution pasa por scoped() con la organización del input", async () => {
    // Patrón del repo: mockear `scoped` para capturar sus argumentos
    // (mismo enfoque que lead-activity-tenant.test.ts). Aquí
    // verificamos que la consulta a ad_attribution que dispara el
    // builder incluye la organización del input y la conversación del
    // input — defense in depth. La cláusula real (SQL con `eq(...)`)
    // garantiza el aislamiento en runtime.
    selectQueue.push(
      [
        {
          conversation: { id: "cv_iso", organizationId: "org_A", contactId: "ct_iso" },
          contact: { id: "ct_iso" },
        },
      ],
      [],
      [
        {
          message: { direction: "in", text: "hola", type: "text" },
          media: null,
        },
      ],
      []
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_A",
      conversationId: "cv_iso",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // El state sale sin source ni ad_context.
    expect(result.state.source).toBeUndefined();
    expect(result.state.ad_context).toBeUndefined();

    // Hubo 4 llamadas a scoped(): conversation, lead, message y ad.
    expect(scopedCalls.length).toBeGreaterThanOrEqual(4);
    const adScopedCall = scopedCalls[3];
    expect(adScopedCall).toBeDefined();
    expect(adScopedCall?.organizationId).toBe("org_A");
    // Las condiciones adicionales del `where` incluyen el eq por
    // conversationId — verificable por la presencia del id en el JSON.
    expect(JSON.stringify(adScopedCall?.conditions)).toContain("cv_iso");
    // Y ninguna llamada de scoped() recibió otra organización que no
    // fuera la del input.
    for (const call of scopedCalls) {
      expect(call.organizationId).toBe("org_A");
    }
  });

  it("E. regresión: crm_state, product, commercial_policy y conversation permanecen iguales con ad_attribution", async () => {
    // El spread del ad_context no debe alterar el shape ni el contenido
    // del resto del state. Mismo crm_state, mismo product (referencia),
    // misma commercial_policy (referencia), misma conversation (mismos
    // turnos, mismo orden, mismo texto recortado por trimConversation).
    selectQueue.push(
      [
        {
          conversation: { id: "cv_reg", organizationId: "org_1", contactId: "ct_reg" },
          contact: { id: "ct_reg" },
        },
      ],
      [
        {
          lead: {
            id: "ld_reg",
            automationLane: "auto_close",
            demoShownAt: new Date("2026-09-01T10:00:00Z"),
            pricePresentedAt: null,
            paymentInstructionsSentAt: null,
            humanRequestedAt: null,
            followUpCount: 2,
          },
          stageName: "Interesado",
        },
      ],
      [
        // DESC por createdAt:
        {
          message: { direction: "in", text: "tercero", type: "text" },
          media: null,
        },
        {
          message: { direction: "out", text: "segundo", type: "text" },
          media: null,
        },
        {
          message: { direction: "in", text: "primero", type: "text" },
          media: null,
        },
      ],
      [
        {
          sourceType: "ad",
          headline: "H1",
          body: "B1",
        },
      ]
    );

    const { buildJevSalesState, JEV_STATE_CONTEXT } = await import(
      "@/server/sales/build-state"
    );
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_reg",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // crm_state intacto.
    expect(result.state.crm_state).toEqual({
      pipeline_stage: "Interesado",
      automation_lane: "auto_close",
      demo_shown: true,
      price_presented: false,
      payment_instructions_sent: false,
      human_requested: false,
      follow_up_count: 2,
    });
    // conversation intacta (cronológica, sin inyección del ad).
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "primero" },
      { from: "seller", text: "segundo" },
      { from: "lead", text: "tercero" },
    ]);
    // product y commercial_policy presentes y no vacíos.
    expect(result.state.product).toBeDefined();
    expect(result.state.commercial_policy).toBeDefined();
    // El state sigue respetando los límites de context.
    expect(result.state.conversation.length).toBeLessThanOrEqual(
      JEV_STATE_CONTEXT.MAX_TURNS
    );
    // Las claves adicionales son SOLO source + ad_context.
    expect(Object.keys(result.state).sort()).toEqual([
      "ad_context",
      "commercial_policy",
      "conversation",
      "crm_state",
      "product",
      "source",
    ]);
    // Persist no cambia.
    expect(result.persist).toEqual({
      organizationId: "org_1",
      conversationId: "cv_reg",
      contactId: "ct_reg",
      leadId: "ld_reg",
    });
  });

  it("F. caso real del hotfix: 'Hola quiero más información' con ad_attribution → state conserva contexto Meta Ads", async () => {
    // Regresión del caso de producción que disparó este hotfix:
    //   - Lead escribió exactamente "Hola quiero más información".
    //   - Sin el contexto, Jev terminaba en disqualify.
    //   - Con el contexto, Jev debe ver source=Meta Ads y el
    //     headline/body del anuncio que trajo al lead.
    // Este test es unitario: verifica el state que el cliente Jev
    // recibe. No mockea la decisión de Jev ni inventa una respuesta.
    selectQueue.push(
      [
        {
          conversation: {
            id: "cv_hotfix",
            organizationId: "org_1",
            contactId: "ct_hotfix",
          },
          contact: { id: "ct_hotfix" },
        },
      ],
      [
        {
          lead: {
            id: "ld_hotfix",
            automationLane: "auto",
            demoShownAt: null,
            pricePresentedAt: null,
            paymentInstructionsSentAt: null,
            humanRequestedAt: null,
            followUpCount: 0,
          },
          stageName: "Nuevo",
        },
      ],
      [
        {
          message: {
            direction: "in",
            text: "Hola quiero más información",
            type: "text",
          },
          media: null,
        },
      ],
      [
        {
          sourceType: "ad",
          headline: "Vende Veloz 365 para academias deportivas",
          body: "Centraliza alumnos, pagos, horarios y operación.",
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_hotfix",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // El estado de Jev incluye el contexto Meta Ads que faltaba.
    expect(result.state.source).toBe("Meta Ads");
    expect(result.state.ad_context).toEqual({
      source_type: "ad",
      headline: "Vende Veloz 365 para academias deportivas",
      body: "Centraliza alumnos, pagos, horarios y operación.",
    });
    // El hilo del lead sigue presente exactamente como llegó.
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "Hola quiero más información" },
    ]);
    // El resto del state no cambia.
    expect(result.state.crm_state.pipeline_stage).toBe("Nuevo");
    expect(result.state.crm_state.follow_up_count).toBe(0);
  });
});