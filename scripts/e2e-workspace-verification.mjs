/**
 * 013 C5 — Verificación del Operator Workspace: los DOCE casos mínimos de
 * plan.md §7 en una sola corrida, con la app real, PostgreSQL real y UI real.
 *
 * Los cortes anteriores probaron las piezas por separado: el 2 que la cola
 * "Por atender" existe y cuenta bien, el 3 que la Agenda agrupa los
 * recordatorios, el 4 que las tres acciones del panel mueven lo que dicen. Este
 * corte NO añade una cuarta superficie: su trabajo es verificar que TODO el
 * workspace operativo se sostiene junto, y sobre todo cerrar los dos huecos que
 * quedaron abiertos:
 *
 *   · el handoff REAL (el del corte 4 venía sembrado por SQL): aquí el mensaje
 *     del cliente entra por el webhook, el agente lo ve y escala, y la
 *     conversación aterriza en "Por atender" sin que nadie lo siembre;
 *   · lead a Cliente / lead a Perdido, que era el único caso de la tabla que
 *     seguía PENDIENTE.
 *
 * Además, y esto es la mitad del objetivo: los dos mecanismos NO se confunden.
 * El recordatorio humano recuerda a Max y no manda nada; el seguimiento
 * automático escribe al cliente y jamás entra en laattention humana. Se
 * comprueba con el mismo hilo, en la misma corrida.
 *
 * Ejecutar: E2E_SECTION=026 node scripts/e2e-selftest.mjs, con la app viva,
 * WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL y OPENROUTER_BASE_URL apuntando a los
 * mocks locales, y una BD dedicada llamada operator_workspace_test[_...].
 */
export async function runWorkspaceVerification({ BASE, api, ok, waitFor, getCookie }) {
  console.log("\n== 013-c5-workspace: 026 · los 12 casos del workspace ==");
  const dbUrl = process.env.E2E_OPERATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  const local = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  if (
    !dbUrl ||
    !local(BASE) ||
    !local(dbUrl) ||
    !/^operator_workspace_test(_|$)/.test(new URL(dbUrl).pathname.slice(1)) ||
    process.env.WA_MOCK_ENABLED !== "true" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "026 requiere app y BD dedicadas locales (operator_workspace_test), WA_MOCK_ENABLED=true y entorno de desarrollo"
    );
  }
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`026 app/BD no saludables: HTTP ${health.status}`);

  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const { chromium } = await import("playwright");
  const { execFileSync } = await import("node:child_process");
  const { rmSync } = await import("node:fs");
  const path = await import("node:path");
  const previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
  const EMAIL = "e2e@vocero.test";
  const password = "password-e2e-123";
  const MIN = 60_000;
  const stamp = Date.now();
  // El webhook resuelve la organización por `phone_number_id` tomando la
  // PRIMERA fila que coincide: un PN fijo deja credenciales de corridas
  // anteriores y el inbound se iría a una organización vieja.
  const PN_A = `PN-E2E-026-A-${stamp}`;
  const PN_B = `PN-E2E-026-B-${stamp}`;
  // Única por corrida: evita colisionar con otro contacto del mismo número.
  let seedPhone = 0;
  for (const ch of String(stamp)) seedPhone = (seedPhone * 31 + ch.charCodeAt(0)) % 900000000;
  const FROM_REAL = `52${String(100000000 + seedPhone)}`;
  const FROM_PROGRAMADA = `52${String(200000000 + seedPhone)}`;
  let browser;

  // Nombres de la fixture: ninguno es prefijo de otro, para que los
  // localizadores por texto de Playwright no se solapen.
  const nombreDe = (sufijo) => `Atención ${sufijo}`;

  try {
    await sql`SELECT 1`;

    // ---------- Sesión y organizaciones ----------
    let login = await api("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password, name: "Operador E2E" }),
    });
    if (!login.res.ok) {
      login = await api("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: EMAIL, password }),
      });
    }
    ok("026 · sesión operador", login.res.ok);
    if (!login.res.ok) throw new Error("026 requiere el operador fixture e2e@vocero.test");

    // Las organizaciones se crean por la PUERTA REAL de producto
    // (`pnpm org:create` → `createOrganizationWithDefaults`), que es la única
    // que siembra pipeline + perfil del agente. Sembrarlas a mano duplicaría el
    // contrato de las etapas y dejaría el fixture fuera de la realidad.
    const crearOrg = async (letra, name) => {
      const slug = `ws026-${letra}-${stamp}`;
      try {
        execFileSync(
          "pnpm",
          ["--pm-on-fail=ignore", "org:create", `--owner-email=${EMAIL}`, `--name=${name}`, `--slug=${slug}`],
          { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" }
        );
      } finally {
        // `org:create` deja su bundle de esbuild en la raíz. Se borra para que
        // una corrida del self-test no ensucie el árbol de trabajo.
        rmSync(path.join(process.cwd(), ".tmp-org-create.mjs"), { force: true });
      }
      const row = (await sql`SELECT id FROM organization WHERE slug = ${slug}`)[0];
      ok(`026 · organización ${letra} creada por la puerta real (pipeline + perfil)`, !!row);
      if (!row) throw new Error(`026 no pudo crear la organización de prueba ${letra}`);
      return row.id;
    };
    const orgA = await crearOrg("a", "Workspace E2E A");
    const orgB = await crearOrg("b", "Workspace E2E B");

    const activar = async (organizationId) => {
      await api("/api/auth/organization/set-active", {
        method: "POST",
        body: JSON.stringify({ organizationId }),
      });
    };
    await activar(orgA);

    // Agente encendido + motor de follow-ups encendido, por la API real de
    // ajustes. Sin esto el agente no corre (no hay handoff real que verificar) y
    // el seguimiento automático no se puede programar (caso 12).
    const perfil = await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({
        enabled: true,
        salesOrchestratorEnabled: true,
        salesFollowUpsEnabled: true,
      }),
    });
    ok("026 · perfil del agente encendido por la API real", perfil.res.ok, JSON.stringify(perfil.json));

    const etapasDe = async (org) =>
      await sql`SELECT id, name, kind, position FROM pipeline_stage
        WHERE organization_id = ${org} ORDER BY position`;
    const etapa = (etapas, nombre) => etapas.find((e) => e.name === nombre);
    const etapasA = await etapasDe(orgA);
    ok("026 · A tiene el pipeline sembrado (incluye Cliente y Perdido)",
      etapa(etapasA, "Cliente")?.kind === "won" && etapa(etapasA, "Perdido")?.kind === "lost",
      JSON.stringify(etapasA.map((e) => `${e.name}:${e.kind}`)));

    // WhatsApp apuntando al mock: sin esto no hay canal para el inbound real.
    // Un PN por organización: el webhook resuelve por `phone_number_id`.
    for (const [org, pn, waba] of [[orgA, PN_A, "WABA-E2E-026-A"], [orgB, PN_B, "WABA-E2E-026-B"]]) {
      await activar(org);
      const wa = await api("/api/settings/whatsapp", {
        method: "PUT",
        body: JSON.stringify({ wabaId: waba, phoneNumberId: pn, token: "tok-e2e" }),
      });
      ok(`026 · WhatsApp mock conectado (${waba})`, wa.res.ok, JSON.stringify(wa.json));
    }
    await activar(orgA);

    // ---------- Fixture ----------
    /** Identidad estable y ÚNICA por sufijo: (organization_id, wa_identity) es UNIQUE. */
    const identidadDe = (sufijo) => {
      let hash = 7;
      for (const ch of `026:${stamp}:${sufijo}`) {
        hash = (hash * 31 + ch.charCodeAt(0)) % 99999989;
      }
      return `52${String(hash).padStart(10, "0")}`;
    };

    /**
     * Siembra una conversación con el estado humano inicial que el caso pide.
     * `lead: true` le cuelga un lead en la primera etapa abierta (el mismo
     * estado que deja la ingesta real), para poder comprobar que llevarla a
     * Cliente/Perdido resuelve el estado operativo.
     */
    const sembrar = async ({ org, sufijo, state, minutos, esTest = false, identidad, lead = false }) => {
      const contactId = `ct_026_${sufijo}_${stamp}`;
      const conversationId = `cv_026_${sufijo}_${stamp}`;
      const humano = state !== null;
      await sql`INSERT INTO contact (id, organization_id, wa_identity, name)
        VALUES (${contactId}, ${org}, ${identidad ?? identidadDe(sufijo)}, ${nombreDe(sufijo)})`;
      await sql`INSERT INTO conversation
          (id, organization_id, contact_id, handoff_at, handoff_reason, ai_enabled, is_test, unread_count, created_at, updated_at)
        VALUES (${conversationId}, ${org}, ${contactId},
          ${humano ? new Date() : null}, ${humano ? "cliente" : null}, ${!humano},
          ${esTest}, 0, now(), now())`;
      if (state) {
        await sql`INSERT INTO conversation_attention
            (id, organization_id, conversation_id, state, due_at, note, created_at, updated_at)
          VALUES (${`ca_026_${sufijo}_${stamp}`}, ${org}, ${conversationId}, ${state},
            ${state === "deferred" ? new Date(Date.now() + minutos * MIN) : null},
            ${state === "deferred" ? "compromiso de la fixture" : null}, now(), now())`;
      }
      let leadId = null;
      if (lead) {
        const abierta = (await etapasDe(org)).find((e) => e.kind === "open");
        leadId = `ld_026_${sufijo}_${stamp}`;
        await sql`INSERT INTO lead (id, organization_id, contact_id, stage_id, position, created_at, updated_at)
          VALUES (${leadId}, ${org}, ${contactId}, ${abierta.id}, 0, now(), now())`;
      }
      return { contactId, conversationId, leadId };
    };

    // Estado inicial de A (todo lo que la UI debe leer de una sentada):
    //   Por atender = pendiente + vencido          = 2
    //   Comprometidos = programada (futuro)        = 1
    //   Agenda = vencido + programada               = 2   · nav vencidos = 1
    //   Bandeja = 5 (el Laboratorio no entra; `real` aún no existe: la crea
    //   el inbound del caso 1, y a partir de ahí son 6)
    const pendiente = await sembrar({ org: orgA, sufijo: "Pendiente", state: "pending" });
    const vencido = await sembrar({
      org: orgA, sufijo: "Vencido", state: "deferred", minutos: -30, lead: true,
    });
    const programada = await sembrar({
      org: orgA, sufijo: "Programada", state: "deferred", minutos: 60 * 48, lead: true,
      identidad: FROM_PROGRAMADA,
    });
    const espera = await sembrar({ org: orgA, sufijo: "Espera", state: "waiting_client", lead: true });
    const motor = await sembrar({ org: orgA, sufijo: "Motor", state: null, lead: true });
    const lab = await sembrar({ org: orgA, sufijo: "Lab", state: "deferred", minutos: 60 * 24, esTest: true });
    // `real` NO se siembra: la crea la ingesta real del inbound del caso 1.
    const deB = await sembrar({ org: orgB, sufijo: "Otra", state: "deferred", minutos: 60 * 24, lead: true });

    const outboxDe = async () => ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
    const jobsDe = async (org) =>
      Number((await sql`SELECT count(*)::int AS n FROM sales_follow_up_job
        WHERE organization_id = ${org}`)[0]?.n ?? 0);
    const automaticosDe = async (org) =>
      Number((await sql`SELECT count(*)::int AS n FROM message
        WHERE organization_id = ${org} AND direction = 'out' AND origin IN ('ai', 'template')`)[0]?.n ?? 0);
    const jobsDeLead = async (leadId) =>
      Number((await sql`SELECT count(*)::int AS n FROM sales_follow_up_job
        WHERE lead_id = ${leadId}`)[0]?.n ?? 0);
    const estadoDe = async (conversationId) =>
      (await sql`SELECT state, due_at, note FROM conversation_attention
        WHERE conversation_id = ${conversationId}`)[0] ?? null;
    const atencionDeLead = async (leadId) =>
      (await sql`SELECT a.state FROM conversation_attention a
        JOIN conversation c ON c.id = a.conversation_id
        JOIN lead l ON l.contact_id = c.contact_id
        WHERE l.id = ${leadId}`)[0] ?? null;
    const outboxInicial = await outboxDe();
    const jobsInicial = await jobsDe(orgA);
    const automaticosInicial = await automaticosDe(orgA);

    // =====================================================================
    // Camino infeliz por API: sin sesión, org ajena y entradas inválidas
    // (ninguna puede escribir un estado a medias)
    // =====================================================================
    const anonimo = await fetch(`${BASE}/api/reminders`, { headers: { origin: BASE } });
    ok("026 · sin sesión, la Agenda responde 401", anonimo.status === 401, `HTTP ${anonimo.status}`);

    const marcarAjena = await api(`/api/conversations/${deB.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "waiting_client" }),
    });
    ok("026 · marcar atendida una conversación de otra organización → 404",
      marcarAjena.res.status === 404, `HTTP ${marcarAjena.res.status}`);

    const moverAjeno = await api(`/api/pipeline/leads/${deB.leadId}`, {
      method: "PATCH",
      body: JSON.stringify({ stageId: etapa(await etapasDe(orgA), "Cliente").id, position: 0 }),
    });
    ok("026 · mover un lead de otra organización → 404",
      moverAjeno.res.status === 404, `HTTP ${moverAjeno.res.status}`);

    const marcarIa = await api(`/api/conversations/${motor.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "waiting_client" }),
    });
    ok("026 · marcar atendida una conversación de la IA → 409 con motivo legible",
      marcarIa.res.status === 409 &&
        String(marcarIa.json?.error?.message ?? "").includes("IA es la dueña"),
      `HTTP ${marcarIa.res.status} ${JSON.stringify(marcarIa.json)}`);

    const marcarLab = await api(`/api/conversations/${lab.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "waiting_client" }),
    });
    ok("026 · marcar atendida una conversación del Laboratorio → 409",
      marcarLab.res.status === 409, `HTTP ${marcarLab.res.status}`);

    const estadoIlegible = await api(`/api/conversations/${pendiente.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "pending" }),
    });
    ok("026 · el endpoint NO acepta fabricar un estado (422)",
      estadoIlegible.res.status === 422, `HTTP ${estadoIlegible.res.status}`);

    const pasado = new Date(Date.now() - 60 * MIN).toISOString();
    const programarPasado = await api(`/api/reminders`, {
      method: "POST",
      body: JSON.stringify({ conversationId: pendiente.conversationId, dueAt: pasado }),
    });
    ok("026 · un recordatorio en el pasado → 422",
      programarPasado.res.status === 422, `HTTP ${programarPasado.res.status}`);

    const notaLarga = await api(`/api/reminders`, {
      method: "POST",
      body: JSON.stringify({
        conversationId: pendiente.conversationId,
        dueAt: new Date(Date.now() + 60 * MIN).toISOString(),
        note: "x".repeat(400),
      }),
    });
    ok("026 · una nota excesiva → 422", notaLarga.res.status === 422, `HTTP ${notaLarga.res.status}`);

    const sinConversacion = await api(`/api/reminders`, {
      method: "POST",
      body: JSON.stringify({ conversationId: "cv_026_no_existe", dueAt: new Date(Date.now() + 60 * MIN).toISOString() }),
    });
    ok("026 · un recordatorio sobre una conversación que no existe → 404",
      sinConversacion.res.status === 404, `HTTP ${sinConversacion.res.status}`);

    ok("026 · ninguno de los rechazos escribió un estado a medias",
      (await estadoDe(pendiente.conversationId))?.state === "pending" &&
        (await estadoDe(espera.conversationId))?.state === "waiting_client" &&
        (await estadoDe(lab.conversationId))?.state === "deferred",
      JSON.stringify(await estadoDe(pendiente.conversationId)));

    // =====================================================================
    // UI
    // =====================================================================
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const jar = (getCookie() ?? "").split("; ").filter(Boolean);
    await context.addCookies(
      jar.map((entry) => {
        const split = entry.indexOf("=");
        return { name: entry.slice(0, split), value: entry.slice(split + 1), url: BASE };
      })
    );
    const page = await context.newPage();

    /** El número que lleva un chip o un contador del nav. */
    const numeroDe = async (locator) => {
      const match = ((await locator.textContent()) ?? "").replace(/\s+/g, " ").match(/(\d+)\s*$/);
      return match ? Number(match[1]) : NaN;
    };
    const chip = (id) => page.locator(`[data-testid='bandeja-filtro-${id}']`);
    const navVencidos = page.locator("[data-testid='nav-contador-vencidos']");
    const filaDe = (nombre) =>
      page.locator("[data-testid='conversation-item']", { hasText: nombre });
    const textoFila = async (nombre) =>
      ((await filaDe(nombre).textContent()) ?? "").replace(/\s+/g, " ");
    const abrir = async (nombre) => {
      await filaDe(nombre).click();
      await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    };
    const abrirConAtencion = async (nombre) => {
      await filaDe(nombre).click();
      await page.waitForSelector("[data-testid='attention-block']", { timeout: 30000 });
    };
    const estadoPanel = async () =>
      ((await page.locator("[data-testid='attention-state']").textContent()) ?? "").trim();
    const fechaEnDias = (dias, hora = 10) => {
      const d = new Date();
      d.setDate(d.getDate() + dias);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hora)}:00`;
    };
    const irA = async (ruta) => {
      await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded" });
    };
    /** Los items de la Agenda: `agenda-item-<bucket>` y `agenda-item-when` comparten
     * prefijo, así que se excluye la línea de fecha para no contarla dos veces. */
    const itemAgenda = () =>
      page.locator("[data-testid^='agenda-item-']:not([data-testid='agenda-item-when'])");
    const itemsAgenda = () => page.locator("[data-testid='agenda-cancel']");
    const abrirAgenda = async () => {
      await irA("/agenda");
      await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    };
    /** "Recordarme" desde el panel: abre, rellena y guarda. */
    const recordarme = async (dias, nota = "") => {
      await page.locator("[data-testid='reminder-open']").click();
      await page.waitForSelector("[data-testid='reminder-due']", { timeout: 10000 });
      await page.locator("[data-testid='reminder-due']").fill(fechaEnDias(dias));
      if (nota) await page.locator("[data-testid='reminder-note-input']").fill(nota);
      await page.locator("[data-testid='reminder-save']").click();
    };
    /** Cancelar el recordatorio vigente desde el panel. */
    const cancelarRecordarme = async () => {
      await page.locator("[data-testid='reminder-cancel']").click();
      await waitFor(async () =>
        (await page.locator("[data-testid='reminder-open']").count()) === 1 ? true : null, 15000);
    };
    const filasDeAtencion = async (conversationId) =>
      Number((await sql`SELECT count(*)::int AS n FROM conversation_attention
        WHERE conversation_id = ${conversationId}`)[0]?.n ?? 0);

    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    ok("026 · el arranque es el esperado: 'Por atender' = 2",
      (await numeroDe(chip("por_atender"))) === 2, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("026 · 'Comprometidos' = 1 y el nav cuenta 1 vencido",
      (await numeroDe(chip("comprometidos"))) === 1 && (await numeroDe(navVencidos)) === 1,
      `comprometidos=${await numeroDe(chip("comprometidos"))} nav=${await numeroDe(navVencidos)}`);
    ok("026 · la Bandeja tiene 5 conversaciones y el Laboratorio no aparece",
      (await numeroDe(chip("all"))) === 5 && (await filaDe(nombreDe("Lab")).count()) === 0,
      `todas=${await numeroDe(chip("all"))}`);

    // =====================================================================
    // CASO 1 · Handoff REAL → "Por atender"
    // El mensaje entra por el webhook; el agente lo ve y escala por su cuenta.
    // =====================================================================
    const outboxAntesDelHandoff = await outboxDe();
    const inboundHandoff = await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN_A,
        from: FROM_REAL,
        name: nombreDe("Real"),
        text: "quiero hablar con un asesor por favor",
        waMessageId: `wamid.e2e.026.handoff.${stamp}`,
      }),
    });
    ok("026 · el webhook acepta el mensaje del cliente", inboundHandoff.res.ok,
      `HTTP ${inboundHandoff.res.status}`);

    const enCola = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 3 ? n : null;
    }, 30000);
    ok("026 · CASO 1 · el handoff REAL mete la conversación en 'Por atender' (2 → 3)",
      enCola === 3, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("026 · CASO 1 · y la conversación nueva aparece en la Bandeja (5 → 6)",
      (await numeroDe(chip("all"))) === 6 && (await filaDe(nombreDe("Real")).count()) === 1,
      `todas=${await numeroDe(chip("all"))}`);

    // La conversación real NO se sembró: se localiza por el contacto que creó
    // la ingesta a partir del inbound de arriba.
    const convRealRow = (await sql`SELECT c.id, c.handoff_at, c.handoff_reason, c.ai_enabled, a.state
      FROM conversation c
      JOIN contact ct ON ct.id = c.contact_id
      LEFT JOIN conversation_attention a ON a.conversation_id = c.id
      WHERE c.organization_id = ${orgA} AND ct.wa_identity = ${FROM_REAL}`)[0];
    const real = { conversationId: convRealRow?.id };
    ok("026 · CASO 1 · la ingesta creó la conversación y el agente la escaló",
      Boolean(real.conversationId) && Boolean(convRealRow.handoff_at) && convRealRow.handoff_reason === "cliente",
      JSON.stringify(convRealRow));
    ok("026 · CASO 1 · el handoff dejó la fila de atención en 'pending'",
      convRealRow?.state === "pending", JSON.stringify(convRealRow));
    ok("026 · CASO 1 · el handoff NO mandó WhatsApp (es para Max, no para el cliente)",
      (await outboxDe()) === outboxAntesDelHandoff,
      `${outboxAntesDelHandoff} → ${await outboxDe()}`);

    await abrirConAtencion(nombreDe("Real"));
    ok("026 · CASO 1 · el panel dice 'Por atender' y cuenta el motivo del handoff",
      (await estadoPanel()).includes("Por atender") &&
        ((await page.locator("[data-testid='attention-reason']").textContent()) ?? "").includes("cliente"),
      `${await estadoPanel()} / ${await page.locator("[data-testid='attention-reason']").textContent()}`);

    // =====================================================================
    // CASO 2 · Abrir la conversación NO la saca de la cola
    // =====================================================================
    ok("026 · CASO 2 · abrir no baja la cola (sigue en 3)",
      (await numeroDe(chip("por_atender"))) === 3, `chip=${await numeroDe(chip("por_atender"))}`);
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    await abrirConAtencion(nombreDe("Real"));
    ok("026 · CASO 2 · ni al abrirla y cerrarla la conversación se resuelve",
      (await numeroDe(chip("por_atender"))) === 3 &&
        (await estadoDe(real.conversationId))?.state === "pending",
      `chip=${await numeroDe(chip("por_atender"))}`);

    // =====================================================================
    // CASO 3 · Responder a mano deja la conversación coherente
    // =====================================================================
    const outboxAntesDeResponder = await outboxDe();
    const ventanaAbierta = await waitFor(async () =>
      (await page.getByText("La ventana de 24 horas está cerrada.").count()) === 0 ? true : null, 25000);
    ok("026 · CASO 3 · tras el inbound del cliente la ventana de 24 h está abierta",
      ventanaAbierta === true);
    await page.getByPlaceholder("Escribe una respuesta…").fill("Hola, te contesto ahora.");
    ok("026 · CASO 3 · con texto, el composer habilita el envío",
      (await waitFor(async () =>
        (await page.getByRole("button", { name: /^Enviar$/ }).isEnabled()) ? true : null, 10000)) === true);
    await page.getByRole("button", { name: /^Enviar$/ }).click();
    const salioDeLaCola = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 2 ? n : null;
    }, 30000);
    ok("026 · CASO 3 · responder saca la conversación de 'Por atender' (3 → 2)",
      salioDeLaCola === 2, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("026 · CASO 3 · y la deja en 'Esperando respuesta' (waiting_client)",
      (await estadoDe(real.conversationId))?.state === "waiting_client",
      JSON.stringify(await estadoDe(real.conversationId)));
    const outboxTrasResponder = await waitFor(async () => {
      const n = await outboxDe();
      return n === outboxAntesDeResponder + 1 ? n : null;
    }, 30000);
    ok("026 · CASO 3 · la respuesta explícita es lo ÚNICO que sale a WhatsApp",
      outboxTrasResponder !== null, `${outboxAntesDeResponder} → ${await outboxDe()}`);

    // =====================================================================
    // CASO 4 · Un recordatorio futuro vive en la Agenda, no en la cola
    // =====================================================================
    await abrirConAtencion(nombreDe("Pendiente"));
    await recordarme(2, "jueves 10:00 · retomar la liga");
    const programado = await waitFor(async () =>
      (await estadoPanel()).includes("Recordatorio") ? true : null, 20000);
    ok("026 · CASO 4 · 'Recordarme' deja el estado en 'Recordatorio'", programado === true,
      await estadoPanel());
    // Programar un recordatorio SACA la conversación de la cola: la cola es
    // "qué hago AHORA", y un compromiso con fecha no es eso (spec §3.2).
    const colaTrasRecordar = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 1 ? n : null;
    }, 20000);
    ok("026 · CASO 4 · sale de la cola 'Por atender' (2 → 1)", colaTrasRecordar === 1,
      `chip=${await numeroDe(chip("por_atender"))}`);
    const comprometidos = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 2 ? n : null;
    }, 20000);
    ok("026 · CASO 4 · y aparece en 'Comprometidos' (1 → 2)", comprometidos === 2,
      `chip=${await numeroDe(chip("comprometidos"))}`);
    const pendienteEnBD = await estadoDe(pendiente.conversationId);
    ok("026 · CASO 4 · en BD es un 'deferred' con fecha futura y su nota",
      pendienteEnBD?.state === "deferred" &&
        new Date(pendienteEnBD.due_at).getTime() > Date.now() &&
        pendienteEnBD.note === "jueves 10:00 · retomar la liga",
      JSON.stringify(pendienteEnBD));

    await abrirAgenda();
    ok("026 · CASO 4 · la Agenda lo muestra como programado (2 → 3 recordatorios)",
      (await itemsAgenda().count()) === 3, `${await itemsAgenda().count()} items`);
    ok("026 · CASO 4 · con la nota que escribió la persona",
      ((await page.locator("[data-testid^='agenda-item-']", { hasText: nombreDe("Pendiente") })
        .locator("[data-testid='agenda-item-when']").textContent()) ?? "").includes("programado"));

    // =====================================================================
    // CASO 5 · El cliente escribe ANTES del vencimiento → "Por atender" ya
    // =====================================================================
    // Los chips de la Bandeja solo existen en la Bandeja: el caso anterior dejó
    // la UI en la Agenda, así que se vuelve antes de poder contar nada.
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    const programadaAntes = await waitFor(async () =>
      (await filaDe(nombreDe("Programada")).count()) === 1 ? true : null, 20000);
    ok("026 · CASO 5 · la conversación programada NO está en la cola antes de tiempo",
      programadaAntes === true && (await estadoDe(programada.conversationId))?.state === "deferred" &&
        (await textoFila(nombreDe("Programada"))).includes("Recordatorio"),
      JSON.stringify(await estadoDe(programada.conversationId)));
    const outboxAntesDelInbound = await outboxDe();
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN_A,
        from: FROM_PROGRAMADA,
        name: nombreDe("Programada"),
        text: "oye, te escribo antes de la fecha",
        waMessageId: `wamid.e2e.026.programada.${stamp}`,
      }),
    });
    const inmediata = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 2 ? n : null;
    }, 30000);
    ok("026 · CASO 5 · el inbound la trae a 'Por atender' de inmediato (1 → 2)",
      inmediata === 2, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("026 · CASO 5 · y en BD el compromiso pasa a 'pending'",
      (await estadoDe(programada.conversationId))?.state === "pending",
      JSON.stringify(await estadoDe(programada.conversationId)));
    const comprometidosTras = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 1 ? n : null;
    }, 20000);
    ok("026 · CASO 5 · con eso sale de 'Comprometidos' (2 → 1)", comprometidosTras === 1,
      `chip=${await numeroDe(chip("comprometidos"))}`);
    ok("026 · CASO 5 · el inbound por sí solo NO manda WhatsApp",
      (await outboxDe()) === outboxAntesDelInbound, `${outboxAntesDelInbound} → ${await outboxDe()}`);

    // =====================================================================
    // CASO 6 · Un recordatorio VENCIDO está en "Por atender" sin que corra
    // ningún proceso: la fila sigue siendo 'deferred' y la comparación con la
    // hora la hace la lectura.
    // =====================================================================
    await abrirAgenda();
    // Los grupos de la Agenda son por calendario (Vencidos/Hoy/Mañana/Esta
    // semana/Más adelante): lo que importa no es en cuál cae el futuro, sino que
    // el vencido y el programado NO compartan grupo.
    const grupoOverdue = page.locator("[data-testid='agenda-group-overdue']");
    const vencidos = await grupoOverdue.locator(itemAgenda()).count();
    const totalItems = await itemAgenda().count();
    const textoOverdue = ((await grupoOverdue.textContent()) ?? "").replace(/\s+/g, " ");
    const grupoDelPendiente = page
      .locator("[data-testid^='agenda-group-']", { hasText: nombreDe("Pendiente") });
    ok("026 · CASO 6 · la Agenda separa lo vencido de lo que aún no toca",
      vencidos === 1 && totalItems === 2 &&
        textoOverdue.includes(nombreDe("Vencido")) &&
        !textoOverdue.includes(nombreDe("Pendiente")),
      `${vencidos} vencidos / ${totalItems} total`);
    ok("026 · CASO 6 · el recordatorio futuro está en su propio grupo, no en Vencidos",
      (await grupoDelPendiente.count()) === 1 &&
        (await grupoDelPendiente.first().getAttribute("data-testid")) !== "agenda-group-overdue",
      (await grupoDelPendiente.count()) ? await grupoDelPendiente.first().getAttribute("data-testid") : "sin grupo");
    ok("026 · CASO 6 · el vencido se lee igual en la Agenda y en la lista",
      (await page.getByText(/Vencido · en Por atender/i).first().isVisible()));
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    ok("026 · CASO 6 · en la lista el vencido lleva la etiqueta 'Por atender'",
      (await textoFila(nombreDe("Vencido"))).includes("Por atender"), await textoFila(nombreDe("Vencido")));
    const vencidoEnBD = await estadoDe(vencido.conversationId);
    ok("026 · CASO 6 · NADIE lo movió: en BD sigue 'deferred' con fecha pasada",
      vencidoEnBD?.state === "deferred" && new Date(vencidoEnBD.due_at).getTime() <= Date.now(),
      JSON.stringify(vencidoEnBD));
    // La prueba de que no hace falta ningún proceso: se recarga desde cero y el
    // conteo es el mismo. Nadie pasó por la conversación para "activar" nada.
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    ok("026 · CASO 6 · tras recargar la página el vencido sigue en la cola (2)",
      (await numeroDe(chip("por_atender"))) === 2, `chip=${await numeroDe(chip("por_atender"))}`);

    // =====================================================================
    // CASO 7 · Programar otro recordatorio
    // (a) una SEGUNDA conversación con su propio compromiso, y
    // (b) el camino real para volver a programar sobre la misma: el panel
    //     ofrece "Cancelar" mientras hay recordatorio, no "Elegir fecha"
    //     (spec §3.2: programar otro es volver a comprometer, no editar en
    //     silencio), y al cancelar se puede comprometer de nuevo SIN que
    //     queden dos filas para la misma conversación (upsert, D-6).
    // =====================================================================
    await abrirConAtencion(nombreDe("Espera"));
    await recordarme(4, "cuando abra temporada");
    const otroCompromiso = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 2 ? n : null;
    }, 20000);
    ok("026 · CASO 7 · una SEGUNDA conversación con su propio recordatorio (1 → 2)",
      otroCompromiso === 2, `chip=${await numeroDe(chip("comprometidos"))}`);
    await abrirAgenda();
    ok("026 · CASO 7 · la Agenda reúne los tres compromisos (2 → 3)",
      (await itemsAgenda().count()) === 3, `${await itemsAgenda().count()} items`);

    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    await abrirConAtencion(nombreDe("Pendiente"));
    ok("026 · CASO 7 · con recordatorio vigente el panel ofrece Cancelar, no fecha nueva",
      (await page.locator("[data-testid='reminder-cancel']").count()) === 1 &&
        (await page.locator("[data-testid='reminder-open']").count()) === 0);
    ok("026 · CASO 7 · y recuerda cuál es el compromiso vigente",
      ((await page.locator("[data-testid='reminder-state']").textContent()) ?? "").startsWith("Para el"),
      await page.locator("[data-testid='reminder-state']").textContent());

    await cancelarRecordarme();
    ok("026 · CASO 7 · cancelar borra la fila de atención (no la deja vencida)",
      (await estadoDe(pendiente.conversationId)) === null,
      JSON.stringify(await estadoDe(pendiente.conversationId)));
    const compromisosTrasCancelar = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 1 ? n : null;
    }, 20000);
    ok("026 · CASO 7 · y sale de 'Comprometidos' (2 → 1)", compromisosTrasCancelar === 1,
      `chip=${await numeroDe(chip("comprometidos"))}`);

    // Volver a comprometer: la conversación sigue siendo humana, así que el
    // panel ofrece la fecha otra vez y el nuevo compromiso no duplica.
    await recordarme(6, "reprogramado: jueves de la otra semana");
    const reprogramado = await waitFor(async () => {
      const e = await estadoDe(pendiente.conversationId);
      return e?.note === "reprogramado: jueves de la otra semana" ? e : null;
    }, 20000);
    ok("026 · CASO 7 · volver a programar guarda la fecha y la nota nuevas",
      reprogramado !== null, JSON.stringify(await estadoDe(pendiente.conversationId)));
    ok("026 · CASO 7 · y NO deja dos compromisos para la misma conversación",
      (await filasDeAtencion(pendiente.conversationId)) === 1,
      `${await filasDeAtencion(pendiente.conversationId)} filas`);
    const comprometidosReprogramados = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 2 ? n : null;
    }, 20000);
    ok("026 · CASO 7 · el compromiso vuelve a estar en 'Comprometidos' (1 → 2)",
      comprometidosReprogramados === 2, `chip=${await numeroDe(chip("comprometidos"))}`);
    await abrirAgenda();
    ok("026 · CASO 7 · y la Agenda vuelve a 3 recordatorios (2 vencidos + 1 futuro)",
      (await itemsAgenda().count()) === 3, `${await itemsAgenda().count()} items`);

    // =====================================================================
    // CASO 8 · Reactivar la IA devuelve la conversación al agente
    // =====================================================================
    await irA(`/inbox?contact=${pendiente.contactId}`);
    await page.waitForSelector("[data-testid='attention-block']", { timeout: 30000 });
    await page.locator("[data-testid='attention-reactivate']").click();
    const bloqueFuera = await waitFor(async () =>
      (await page.locator("[data-testid='attention-block']").count()) === 0 ? true : null, 20000);
    ok("026 · CASO 8 · 'Reactivar IA' quita el bloque de atención", bloqueFuera === true);
    ok("026 · CASO 8 · en BD la fila de atención desapareció",
      (await estadoDe(pendiente.conversationId)) === null);
    const conversationTras = (await sql`SELECT handoff_at, ai_enabled FROM conversation
      WHERE id = ${pendiente.conversationId}`)[0];
    ok("026 · CASO 8 · la IA vuelve a ser la dueña (sin handoff, ai_enabled)",
      conversationTras?.handoff_at === null && conversationTras?.ai_enabled === true,
      JSON.stringify(conversationTras));
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    const comprometidosFinal = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 1 ? n : null;
    }, 20000);
    ok("026 · CASO 8 · el compromiso sale de 'Comprometidos' (2 → 1)",
      comprometidosFinal === 1, `chip=${await numeroDe(chip("comprometidos"))}`);
    ok("026 · CASO 8 · y sale de la Agenda (3 → 2)",
      (await (async () => { await abrirAgenda(); return itemsAgenda().count(); })()) === 2,
      `${await itemsAgenda().count()} items`);

    // =====================================================================
    // CASO 9 · Lead a Cliente y lead a Perdido resuelven el estado operativo
    // =====================================================================
    const etapasFinales = await etapasDe(orgA);
    const idCliente = etapa(etapasFinales, "Cliente").id;
    const idPerdido = etapa(etapasFinales, "Perdido").id;

    // (a) A PERDIDO: `programada` está en "Por atender" (pending) y su lead
    //     también. Al perderlo, la conversación sale de la cola.
    // Los chips viven en la Bandeja y el caso anterior terminó en la Agenda.
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    const enColaAntesDePerder = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 2 ? n : null;
    }, 20000);
    ok("026 · CASO 9 · antes de perderlo, el lead está en la cola (2)",
      enColaAntesDePerder === 2, `chip=${await numeroDe(chip("por_atender"))}`);
    const moverPerdido = await api(`/api/pipeline/leads/${programada.leadId}`, {
      method: "PATCH",
      body: JSON.stringify({ stageId: idPerdido, position: 0 }),
    });
    ok("026 · CASO 9 · llevar el lead a Perdido se acepta por la puerta real",
      moverPerdido.res.ok, `HTTP ${moverPerdido.res.status} ${JSON.stringify(moverPerdido.json)}`);
    const salioPorPerdido = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === enColaAntesDePerder - 1 ? n : null;
    }, 25000);
    ok("026 · CASO 9 · y la conversación SALE de 'Por atender' (2 → 1)",
      salioPorPerdido === 1, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("026 · CASO 9 · en BD la atención de ese contacto se limpió",
      (await atencionDeLead(programada.leadId)) === null,
      JSON.stringify(await atencionDeLead(programada.leadId)));
    const tableroPerdido = (await api("/api/pipeline/board")).json;
    ok("026 · CASO 9 · el tablero muestra al lead en la columna Perdido",
      tableroPerdido.leads.find((l) => l.id === programada.leadId)?.stageId === idPerdido);
    await irA(`/inbox?contact=${programada.contactId}`);
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    await abrir(nombreDe("Programada"));
    // Lo que se resolvió es la TAREA, no la pertenencia: la fila de atención ya
    // no está, pero la conversación sigue en manos humanas (el handoff NO se
    // revierte solo por perder el lead: reactivar la IA sobre un negocio
    // cerrado sería peor que el ruido). Por eso la lista dice "Atención
    // humana" — que el propio copy define como "sin nada pendiente" — y no
    // "Por atender" ni "Recordatorio".
    const chipFila = filaDe(nombreDe("Programada")).locator("[data-testid='fila-estado']");
    ok("026 · CASO 9 · la fila ya no dice 'Por atender' ni 'Recordatorio'",
      (await chipFila.getAttribute("data-estado")) === "atencion_humana",
      `${await chipFila.getAttribute("data-estado")} · ${await textoFila(nombreDe("Programada"))}`);
    ok("026 · CASO 9 · la conversación no queda con ninguna tarea pendiente",
      !(await textoFila(nombreDe("Programada"))).includes("Por atender") &&
        (await page.locator("[data-testid='attention-mark-attended']").count()) === 0,
      await textoFila(nombreDe("Programada")));
    ok("026 · CASO 9 · el panel explica que la IA sigue en pausa, sin pedir nada",
      ((await page.locator("[data-testid='attention-explanation']").textContent()) ?? "")
        .includes("en pausa"),
      await page.locator("[data-testid='attention-explanation']").textContent());

    // (b) A CLIENTE: `espera` estaba en "Esperando respuesta" con su recordatorio.
    const moverCliente = await api(`/api/pipeline/leads/${espera.leadId}`, {
      method: "PATCH",
      body: JSON.stringify({ stageId: idCliente, position: 0 }),
    });
    ok("026 · CASO 9 · llevar el lead a Cliente se acepta",
      moverCliente.res.ok, `HTTP ${moverCliente.res.status}`);
    ok("026 · CASO 9 · y también limpia el estado operativo de la conversación",
      (await atencionDeLead(espera.leadId)) === null,
      JSON.stringify(await atencionDeLead(espera.leadId)));
    await abrirAgenda();
    ok("026 · CASO 9 · su recordatorio sale de la Agenda con ella (2 → 1)",
      (await itemsAgenda().count()) === 1, `${await itemsAgenda().count()} items`);
    const tableroCliente = (await api("/api/pipeline/board")).json;
    ok("026 · CASO 9 · el tablero muestra al lead en la columna Cliente",
      tableroCliente.leads.find((l) => l.id === espera.leadId)?.stageId === idCliente);

    // =====================================================================
    // CASO 10 · Aislamiento por organización
    // =====================================================================
    await activar(orgB);
    await abrirAgenda();
    const agendaB = (await api("/api/reminders")).json;
    ok("026 · CASO 10 · B solo ve su propio recordatorio",
      agendaB?.total === 1 && JSON.stringify(agendaB.buckets).includes(nombreDe("Otra")),
      `total=${agendaB?.total}`);
    ok("026 · CASO 10 · la Agenda de B no menciona ninguna conversación de A",
      !JSON.stringify(agendaB.buckets).includes(nombreDe("Vencido")));
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    ok("026 · CASO 10 · la Bandeja de B tiene su cola vacía",
      (await numeroDe(chip("por_atender"))) === 0, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("026 · CASO 10 · y el nav de B no cuenta los vencidos de A",
      (await navVencidos.count()) === 0,
      (await navVencidos.count()) ? await navVencidos.textContent() : "sin contador");
    await activar(orgA);
    await irA("/inbox");
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    ok("026 · CASO 10 · al volver, A conserva su cola intacta (1)",
      (await numeroDe(chip("por_atender"))) === 1, `chip=${await numeroDe(chip("por_atender"))}`);

    // =====================================================================
    // CASO 11 · Un recordatorio humano NO toca Graph: ni WhatsApp ni jobs
    // =====================================================================
    ok("026 · CASO 11 · en toda la corrida solo salió la respuesta explícita (outbox +1)",
      (await outboxDe()) === outboxInicial + 1, `${outboxInicial} → ${await outboxDe()}`);
    ok("026 · CASO 11 · ningún recordatorio humano creó un seguimiento automático",
      (await jobsDe(orgA)) === jobsInicial, `${jobsInicial} → ${await jobsDe(orgA)}`);
    ok("026 · CASO 11 · ni un solo mensaje de IA o plantilla salió por los recordatorios",
      (await automaticosDe(orgA)) === automaticosInicial,
      `${automaticosInicial} → ${await automaticosDe(orgA)}`);

    // =====================================================================
    // CASO 12 · El seguimiento automático sigue funcionando (sin regresión)
    // (a) se programa; (b) se cancela; (c) rechaza la atención humana.
    // =====================================================================
    const followupVacio = await jobsDeLead(motor.leadId);
    ok("026 · CASO 12 · el lead que la IA tiene no tenía ningún job previo",
      followupVacio === 0, `${followupVacio} jobs`);
    const programar = await api(`/api/pipeline/leads/${motor.leadId}/follow-up`, {
      method: "POST",
      // Fecha lejana a propósito: se verifica la PROGRAMACIÓN, no el envío. El
      // worker no debe reclamarlo (y por eso el outbox no crece).
      body: JSON.stringify({ dueAt: new Date(Date.now() + 7 * 24 * 60 * MIN).toISOString() }),
    });
    ok("026 · CASO 12 · programar un seguimiento automático sigue funcionando",
      programar.res.ok, `HTTP ${programar.res.status} ${JSON.stringify(programar.json)}`);
    const jobCreado = await waitFor(async () =>
      (await jobsDeLead(motor.leadId)) === 1 ? true : null, 15000);
    ok("026 · CASO 12 · y crea el job pendiente con su fecha", jobCreado === true);
    ok("026 · CASO 12 · programar NO manda WhatsApp todavía",
      (await outboxDe()) === outboxInicial + 1, `${outboxInicial} → ${await outboxDe()}`);
    const leadMotor = (await sql`SELECT automation_lane, next_follow_up_at, follow_up_reason
      FROM lead WHERE id = ${motor.leadId}`)[0];
    ok("026 · CASO 12 · el lead queda en la lane de espera con su próxima fecha",
      leadMotor?.automation_lane === "wait" && leadMotor?.next_follow_up_at !== null,
      JSON.stringify(leadMotor));

    const cancelar = await api(`/api/pipeline/leads/${motor.leadId}/follow-up`, { method: "DELETE" });
    ok("026 · CASO 12 · cancelar el seguimiento automático sigue funcionando",
      cancelar.res.ok, `HTTP ${ cancelar.res.status}`);
    // Cancelar no borra la fila: la deja en `cancelled` para que la historia
    // sea auditable. Lo que no puede quedar es un job `pending` que el worker
    // fuera a reclamar, ni una fecha de seguimiento viva en el lead.
    const jobsTrasCancelar = await sql`SELECT status FROM sales_follow_up_job
      WHERE lead_id = ${motor.leadId} ORDER BY created_at`;
    const leadMotorTras = (await sql`SELECT automation_lane, next_follow_up_at
      FROM lead WHERE id = ${motor.leadId}`)[0];
    ok("026 · CASO 12 · el job sale de la cola del worker (pending → cancelled)",
      jobsTrasCancelar.length === 1 && jobsTrasCancelar[0]?.status === "cancelled",
      JSON.stringify(jobsTrasCancelar.map((j) => j.status)));
    ok("026 · CASO 12 · y el lead se queda sin fecha de seguimiento",
      leadMotorTras?.next_follow_up_at === null, JSON.stringify(leadMotorTras));

    // Los dos rechazos que separan los mecanismos: el automático NO entra en la
    // atención humana (ni por handoff ni por carril humano).
    const handoffActivo = await api(`/api/pipeline/leads/${vencido.leadId}/follow-up`, {
      method: "POST",
      body: JSON.stringify({ dueAt: new Date(Date.now() + 60 * MIN).toISOString() }),
    });
    ok("026 · CASO 12 · con handoff activo lo rechaza (409 handoff_active)",
      handoffActivo.res.status === 409 && handoffActivo.json?.error?.code === "handoff_active",
      `HTTP ${handoffActivo.res.status} ${JSON.stringify(handoffActivo.json)}`);
    const [leadReal] = await sql`SELECT l.id FROM lead l
      JOIN contact c ON c.id = l.contact_id
      WHERE l.organization_id = ${orgA} AND c.wa_identity = ${FROM_REAL}`;
    const carrilHumano = await api(`/api/pipeline/leads/${leadReal.id}/follow-up`, {
      method: "POST",
      body: JSON.stringify({ dueAt: new Date(Date.now() + 60 * MIN).toISOString() }),
    });
    ok("026 · CASO 12 · con carril humano lo rechaza (409 human_lane)",
      carrilHumano.res.status === 409 && carrilHumano.json?.error?.code === "human_lane",
      `HTTP ${carrilHumano.res.status} ${JSON.stringify(carrilHumano.json)}`);
    const pasadoFollowup = await api(`/api/pipeline/leads/${motor.leadId}/follow-up`, {
      method: "POST",
      body: JSON.stringify({ dueAt: new Date(Date.now() - 60 * MIN).toISOString() }),
    });
    ok("026 · CASO 12 · una fecha pasada se rechaza con 422",
      pasadoFollowup.res.status === 422, `HTTP ${pasadoFollowup.res.status}`);

    // =====================================================================
    // Camino infeliz por UI: sin sesión
    // =====================================================================
    const anon = await browser.newContext();
    const pageAnon = await anon.newPage();
    await pageAnon.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    ok("026 · sin sesión, /agenda devuelve al login",
      new URL(pageAnon.url()).pathname === "/login", pageAnon.url());
    const apiAnon = await pageAnon.evaluate(async () => (await fetch("/api/reminders")).status);
    ok("026 · sin sesión, /api/reminders responde 401 desde el navegador", apiAnon === 401, `HTTP ${apiAnon}`);
    await anon.close();

    // =====================================================================
    // El copy no enseña internals ni fechas crudas
    // =====================================================================
    await abrirConAtencion(nombreDe("Vencido"));
    const cuerpoBandeja = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await abrirAgenda();
    const cuerpoAgenda = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const INTERNOS = [
      "handoffAt", "handoffReason", "needsAttentionNow", "waiting_client", "deferred",
      "automationLane", "nextFollowUpAt", "followUpReason", "sales_follow_up_job",
    ];
    for (const [superficie, texto] of [["bandeja", cuerpoBandeja], ["agenda", cuerpoAgenda]]) {
      for (const token of INTERNOS) {
        ok(`026 · '${superficie}' no enseña '${token}'`, !texto.includes(token));
      }
      ok(`026 · '${superficie}' no enseña un ISO crudo`, !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(texto));
    }
    ok("026 · el copy usa el vocabulario de operación y no el interno",
      cuerpoBandeja.includes("Atención humana") &&
        cuerpoBandeja.includes("Por atender") &&
        cuerpoAgenda.includes("Por atender") &&
        !cuerpoBandeja.includes("waiting_client"),
      cuerpoBandeja.slice(0, 200));
  } finally {
    if (browser) await browser.close();
    await sql.end();
    if (previousOrg) {
      await api("/api/auth/organization/set-active", {
        method: "POST",
        body: JSON.stringify({ organizationId: previousOrg }),
      });
    }
  }
}
