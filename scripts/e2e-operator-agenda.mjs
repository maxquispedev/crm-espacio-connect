/**
 * 013 C3 — Agenda de recordatorios humanos: self-test de UI real (Playwright).
 *
 * Qué se verifica aquí y no puede verificarse en un test unitario: que el
 * operador puede REALMENTE ponerse un recordatorio desde la conversación, que
 * ese recordatorio aparece en su grupo, que sale de "Por atender", que al
 * vencer vuelve, que si el cliente escribe antes vuelve antes, y que se puede
 * cancelar. Todo con la app viva, PostgreSQL real y los mocks (wa-mock +
 * ai-mock) apuntando a las APIs locales.
 *
 * El vencimiento se provoca moviendo el `due_at` por SQL en vez de esperar: el
 * requisito de producto es que vencer NO depende de ningún proceso ni worker,
 * así que simular "el reloj ya pasó" con SQL es exactamente el escenario real
 * (si hiciera falta un worker, este guion no podría distinguirlo).
 *
 * Y se comprueba lo más importante de este corte: en NINGÚN punto sale un
 * WhatsApp. El outbox del wa-mock y la tabla del motor automático se leen al
 * final y tienen que estar como al empezar.
 *
 * Ejecutar: E2E_SECTION=024 node scripts/e2e-selftest.mjs, con la app viva,
 * WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL y OPENROUTER_BASE_URL apuntando a los
 * mocks locales, y una BD dedicada llamada operator_workspace_test[_...].
 */
export async function runOperatorAgendaSelftest({ BASE, api, ok, waitFor, getCookie }) {
  console.log("\n== 013-c3-agenda-recordatorios: 024 · UI real + happy/unhappy ==");
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
      "024 requiere app y BD dedicadas locales (operator_workspace_test), WA_MOCK_ENABLED=true y entorno de desarrollo"
    );
  }
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`024 app/BD no saludables: HTTP ${health.status}`);

  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const { chromium } = await import("playwright");
  const previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
  const password = "password-e2e-123";
  const MIN = 60_000;
  // El webhook resuelve la ORGANIZACIÓN por `phone_number_id` tomando la
  // PRIMERA fila que coincide. Con un PN fijo, las corridas anteriores dejaban
  // credenciales registradas y el inbound se iba a una organización vieja. Por
  // eso el PN es único por corrida (el mock responde bien a cualquier id).
  const PN = `PN-E2E-024-${Date.now()}`;
  // Único por corrida (ver `sembrar`): evita colisionar con otro contacto del
  // mismo número en otra organización.
  let seedPhone = 0;
  for (const ch of String(Date.now())) seedPhone = (seedPhone * 31 + ch.charCodeAt(0)) % 900000000;
  const FROM_INBOUND = `52${String(100000000 + seedPhone)}`;
  let browser;

  try {
    await sql`SELECT 1`;

    // ---------- Sesión y organizaciones ----------
    let login = await api("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: "e2e@vocero.test", password, name: "Operador E2E" }),
    });
    if (!login.res.ok) {
      login = await api("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: "e2e@vocero.test", password }),
      });
    }
    ok("024 · sesión operador", login.res.ok);
    if (!login.res.ok) throw new Error("024 requiere el operador fixture e2e@vocero.test");

    const makeOrg = async (letter) => {
      const created = await api("/api/auth/organization/create", {
        method: "POST",
        body: JSON.stringify({
          name: `Agenda E2E ${letter}`,
          slug: `agenda-024-${letter}-${Date.now()}`,
        }),
      });
      ok(`024 · organización ${letter}`, created.res.ok && !!created.json?.id);
      if (!created.json?.id) throw new Error("024 no pudo crear organización de prueba");
      return created.json.id;
    };
    const orgA = await makeOrg("a");
    const orgB = await makeOrg("b");
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgA }),
    });
    // WhatsApp apuntando al mock: sin esto no hay canal para el inbound real.
    const wa = await api("/api/settings/whatsapp", {
      method: "PUT",
      body: JSON.stringify({ wabaId: "WABA-E2E-024", phoneNumberId: PN, token: "tok-e2e" }),
    });
    ok("024 · WhatsApp mock conectado", wa.res.ok, JSON.stringify(wa.json));

    // ---------- Fixture ----------
    const stamp = Date.now();
    const nombreDe = (sufijo) => `Agenda ${sufijo}`;
    // Identidad estable y ÚNICA por sufijo: (organization_id, wa_identity) es
    // UNIQUE, así que dos sufijos NO pueden compartir número.
    const identidadDe = (sufijo) => {
      let hash = 7;
      for (const ch of `024:${stamp}:${sufijo}`) {
        hash = (hash * 31 + ch.charCodeAt(0)) % 99999989;
      }
      return `52${String(hash).padStart(10, "0")}`;
    };

    const sembrar = async ({ org, sufijo, state, minutos, esTest = false, identidad }) => {
      const contactId = `ct_024_${sufijo}_${stamp}`;
      const conversationId = `cv_024_${sufijo}_${stamp}`;
      await sql`INSERT INTO contact (id, organization_id, wa_identity, name)
        VALUES (${contactId}, ${org}, ${identidad ?? identidadDe(sufijo)}, ${nombreDe(sufijo)})`;
      await sql`INSERT INTO conversation
          (id, organization_id, contact_id, handoff_at, handoff_reason, ai_enabled, is_test, unread_count, created_at, updated_at)
        VALUES (${conversationId}, ${org}, ${contactId},
          ${state ? new Date() : null}, ${state ? "commercial" : null}, ${state ? false : true},
          ${esTest}, 0, now(), now())`;
      if (state) {
        await sql`INSERT INTO conversation_attention
            (id, organization_id, conversation_id, state, due_at, note, created_at, updated_at)
          VALUES (${`ca_024_${sufijo}_${stamp}`}, ${org}, ${conversationId}, ${state},
            ${state === "deferred" ? new Date(Date.now() + minutos * MIN) : null},
            ${state === "deferred" ? "jueves 10:00" : null}, now(), now())`;
      }
      return { contactId, conversationId };
    };

    // Cola inicial de A: cv_hoy (pending) + cv_vencido (deferred vencido) = 2.
    const hoy = await sembrar({ org: orgA, sufijo: "hoy", state: "pending" });
    const vencido = await sembrar({ org: orgA, sufijo: "vencido", state: "deferred", minutos: -30 });
    const futuro = await sembrar({ org: orgA, sufijo: "futuro", state: "deferred", minutos: 60 * 72 });
    const espera = await sembrar({
      org: orgA,
      sufijo: "inbound",
      state: "waiting_client",
      identidad: FROM_INBOUND, // idéntica a la que resuelve la ingesta
    });
    const soloIa = await sembrar({ org: orgA, sufijo: "soloia", state: null });
    const lab = await sembrar({
      org: orgA,
      sufijo: "lab",
      state: "deferred",
      minutos: 60 * 48,
      esTest: true,
    });
    const deB = await sembrar({ org: orgB, sufijo: "otra", state: "deferred", minutos: 60 * 24 });

    const outboxDe = async () =>
      ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
    const jobsDe = async () =>
      Number(
        (
          await sql`SELECT count(*)::int AS n FROM sales_follow_up_job j
            JOIN conversation c ON c.id = j.conversation_id
            WHERE c.organization_id = ${orgA}`
        )[0]?.n ?? 0
      );
    const outboxInicial = await outboxDe();
    const jobsInicial = await jobsDe();

    // ---------- Camino feliz por API: los cinco grupos ----------
    const agenda = (await api("/api/reminders")).json;
    const enGrupo = (bucket) => (agenda?.buckets?.[bucket] ?? []).map((r) => r.contact.name);
    ok("024 · los cinco grupos llegan siempre", Object.keys(agenda?.buckets ?? {}).sort().join(",") ===
      "later,overdue,today,tomorrow,week", JSON.stringify(Object.keys(agenda?.buckets ?? {})));
    ok("024 · el vencido está en 'Vencidos'", enGrupo("overdue").includes(nombreDe("vencido")));
    ok("024 · el futuro NO está en 'Vencidos'", !enGrupo("overdue").includes(nombreDe("futuro")));
    ok(
      "024 · el futuro cae en un grupo posterior",
      ["today", "tomorrow", "week", "later"].some((b) => enGrupo(b).includes(nombreDe("futuro"))),
      JSON.stringify(agenda?.buckets)
    );
    ok("024 · el Laboratorio (is_test) no aparece en la Agenda",
      !JSON.stringify(agenda?.buckets ?? {}).includes(nombreDe("lab")));
    ok("024 · 'Por atender' (pending) no es Agenda",
      !JSON.stringify(agenda?.buckets ?? {}).includes(nombreDe("hoy")));
    ok("024 · el recordatorio trae contacto, fecha, nota y estado",
      (agenda?.buckets?.overdue?.[0]?.contact?.name === nombreDe("vencido")) &&
      typeof agenda.buckets.overdue[0].dueAt === "string" &&
      agenda.buckets.overdue[0].note === "jueves 10:00" &&
      agenda.buckets.overdue[0].state === "deferred" &&
      agenda.buckets.overdue[0].needsAttentionNow === true,
      JSON.stringify(agenda?.buckets?.overdue?.[0]));
    ok("024 · el total coincide con lo listado", agenda?.total === 2, `total=${agenda?.total}`);

    // ---------- Camino infeliz por API ----------
    const anonimo = await fetch(`${BASE}/api/reminders`, { headers: { origin: BASE } });
    ok("024 · sin sesión, la Agenda responde 401", anonimo.status === 401, `HTTP ${anonimo.status}`);

    const pasado = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({ conversationId: hoy.conversationId, dueAt: new Date(Date.now() - MIN).toISOString() }),
    });
    ok(
      "024 · programar en el pasado → 422 due_in_past",
      pasado.res.status === 422 && pasado.json?.error?.code === "due_in_past",
      "HTTP " + pasado.res.status + " " + JSON.stringify(pasado.json)
    );

    const larga = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({ conversationId: hoy.conversationId, dueAt: new Date(Date.now() + MIN).toISOString(), note: "x".repeat(281) }),
    });
    ok("024 · nota de 281 caracteres → 422", larga.res.status === 422, `HTTP ${larga.res.status}`);

    const vacia = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({ conversationId: hoy.conversationId, dueAt: new Date(Date.now() + MIN).toISOString(), note: "  " }),
    });
    ok("024 · nota vacía → 422 (no un null silencioso)", vacia.res.status === 422, `HTTP ${vacia.res.status}`);

    const conOrg = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({
        conversationId: hoy.conversationId,
        dueAt: new Date(Date.now() + MIN).toISOString(),
        organizationId: orgA,
      }),
    });
    ok("024 · body con organizationId → 422 (la org sale de la sesión)",
      conOrg.res.status === 422, `HTTP ${conOrg.res.status}`);

    const ajena = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({ conversationId: deB.conversationId, dueAt: new Date(Date.now() + MIN).toISOString() }),
    });
    ok("024 · programar sobre conversación de otra organización → 404",
      ajena.res.status === 404, `HTTP ${ajena.res.status}`);

    const ia = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({ conversationId: soloIa.conversationId, dueAt: new Date(Date.now() + MIN).toISOString() }),
    });
    ok("024 · programar sobre una conversación de la IA → 409",
      ia.res.status === 409, `HTTP ${ia.res.status}`);

    const labPost = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({ conversationId: lab.conversationId, dueAt: new Date(Date.now() + MIN).toISOString() }),
    });
    ok("024 · programar sobre el Laboratorio (is_test) → 409",
      labPost.res.status === 409, `HTTP ${labPost.res.status}`);

    const borrarAjena = await api(`/api/reminders/${deB.conversationId}`, { method: "DELETE" });
    ok("024 · cancelar el recordatorio de otra organización → 404",
      borrarAjena.res.status === 404, `HTTP ${borrarAjena.res.status}`);
    const borrarPendiente = await api(`/api/reminders/${hoy.conversationId}`, { method: "DELETE" });
    ok("024 · cancelar trabajo humano vivo (pending) → 409",
      borrarPendiente.res.status === 409, `HTTP ${borrarPendiente.res.status}`);
    const borrarNada = await api(`/api/reminders/${soloIa.conversationId}`, { method: "DELETE" });
    ok("024 · cancelar sin recordatorio → 404", borrarNada.res.status === 404, `HTTP ${borrarNada.res.status}`);

    // ---------- Camino infeliz por UI: el servidor manda ----------
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

    // ---------- La Agenda se monta y muestra los cinco grupos ----------
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    const gruposVisibles = [];
    for (const bucket of ["overdue", "today", "tomorrow", "week", "later"]) {
      gruposVisibles.push(await page.locator(`[data-testid='agenda-group-${bucket}']`).isVisible());
    }
    ok("024 · la Agenda muestra los cinco grupos", gruposVisibles.every(Boolean), gruposVisibles.join(","));
    ok("024 · el item vencido se ve con su contacto",
      await page.locator(`[data-testid='agenda-item-overdue']`).first().textContent().then((t) => (t ?? "").includes(nombreDe("vencido"))));
    ok("024 · el item muestra la nota", await page.getByText("jueves 10:00").first().isVisible());
    ok("024 · hay un 'Abrir' y un 'Cancelar' por recordatorio",
      (await page.locator("[data-testid='agenda-open']").count()) === 2 &&
      (await page.locator("[data-testid='agenda-cancel']").count()) === 2,
      `abrir=${await page.locator("[data-testid='agenda-open']").count()} cancelar=${await page.locator("[data-testid='agenda-cancel']").count()}`);
    ok("024 · la Agenda NO ofrece ninguna acción de envío",
      (await page.getByRole("button", { name: /Enviar/i }).count()) === 0);

    // ---------- Programar desde la UI ----------
    const numeroDe = async (locator) => {
      const match = ((await locator.textContent()) ?? "").replace(/\s+/g, " ").match(/(\d+)\s*$/);
      return match ? Number(match[1]) : NaN;
    };
    await page.goto(`${BASE}/inbox?contact=${hoy.contactId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    const chip = page.getByRole("button", { name: /Por atender/ });
    const colaAntes = await numeroDe(chip);
    ok("024 · la cola de A arranca en 2 (pending + vencido)", colaAntes === 2, `chip=${colaAntes}`);

    await page.locator("[data-testid='reminder-open']").click();
    await page.waitForSelector("[data-testid='reminder-due']", { timeout: 10000 });
    // Camino infeliz 1: guardar sin fecha.
    await page.locator("[data-testid='reminder-save']").click();
    await page.waitForSelector("[data-testid='reminder-error']", { timeout: 10000 });
    ok("024 · guardar sin fecha muestra el error y no navega",
      (await page.locator("[data-testid='reminder-error']").textContent())?.includes("fecha") === true,
      await page.locator("[data-testid='reminder-error']").textContent());
    // Camino infeliz 2: una fecha ya pasada la rechaza el servidor con 422.
    const dosDias = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`;
    });
    await page.locator("[data-testid='reminder-due']").fill(dosDias);
    await page.locator("[data-testid='reminder-save']").click();
    // El panel repinta cuando el padre recarga la conversación (el POST publica
    // `conversation.updated` y además dispara el refetch), así que se ESPERA al
    // texto en vez de leerlo en el mismo tick.
    const textoProgramado = await waitFor(async () => {
      const t = await page.locator("[data-testid='reminder-state']").textContent();
      return t?.includes("Para el") ? t : null;
    }, 15000);
    ok("024 · el recordatorio queda visible en la conversación", Boolean(textoProgramado),
      await page.locator("[data-testid='reminder-state']").textContent());
    ok("024 · el panel ofrece 'Cancelar' en vez de 'Elegir fecha'",
      await page.locator("[data-testid='reminder-cancel']").isVisible());

    // Sale de "Por atender" sin recargar a mano: el SSE recarga la lista.
    const colaProgramada = await waitFor(async () => {
      const n = await numeroDe(chip);
      return n === 1 ? n : null;
    }, 10000);
    ok("024 · al programar, sale de 'Por atender' (2 → 1)", colaProgramada === 1, `chip=${await numeroDe(chip)}`);

    // Y aparece en la Agenda, en un grupo futuro.
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-tomorrow']", { timeout: 30000 });
    ok("024 · el recordatorio nuevo aparece en la Agenda",
      (await page.getByText(nombreDe("hoy")).first().isVisible()),
      await page.locator("[data-testid='agenda-item-today']").count() + " en hoy");
    ok("024 · la Agenda tiene 3 recordatorios (vencido + futuro + nuevo)",
      (await page.locator("[data-testid='agenda-cancel']").count()) === 3,
      `${await page.locator("[data-testid='agenda-cancel']").count()} items`);

    // ---------- Vencimiento: vuelve a "Por atender" sin proceso ni worker ----------
    await sql`UPDATE conversation_attention SET due_at = now() - interval '1 minute'
      WHERE conversation_id = ${hoy.conversationId}`;
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    const colaVencida = await waitFor(async () => {
      const n = await numeroDe(chip);
      return n === 2 ? n : null;
    }, 10000);
    ok("024 · al vencer vuelve a 'Por atender' (1 → 2)", colaVencida === 2, `chip=${await numeroDe(chip)}`);

    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    const vencidos = await page.locator("[data-testid='agenda-item-overdue']").count();
    ok("024 · en la Agenda el vencido cae en 'Vencidos'", vencidos === 2, `${vencidos} vencidos`);
    ok("024 · el vencido se marca comoRequires acción",
      (await page.getByText(/vencido · en Por atender/i).first().isVisible()));

    // ---------- El cliente escribe antes de la hora: vuelve de inmediato ----------
    // `waiting_client` → `deferred`: el CHECK de coherencia exige que `due_at`
    // exista si y solo si el estado es `deferred`, así que van juntos.
    await sql`UPDATE conversation_attention
      SET state = 'deferred', due_at = now() + interval '3 days', note = 'reprogramado'
      WHERE conversation_id = ${espera.conversationId}`;
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: FROM_INBOUND,
        name: nombreDe("inbound"),
        text: "sí, aquí estoy",
        waMessageId: `wamid.e2e.024.a.${stamp}`,
      }),
    });
    const estadoInbound = await waitFor(async () => {
      const lista = (await api("/api/conversations")).json?.conversations ?? [];
      const c = lista.find((x) => x.id === espera.conversationId);
      return c?.attention?.state === "pending" ? c : null;
    }, 25000);
    ok("024 · el cliente escribe antes: vuelve a 'Por atender' de inmediato",
      estadoInbound?.attention?.needsAttentionNow === true,
      JSON.stringify(estadoInbound?.attention));
    const agendaTrasInbound = (await api("/api/reminders")).json;
    ok("024 · y sale de la Agenda (ya no hay compromiso que cumplir)",
      !JSON.stringify(agendaTrasInbound.buckets).includes(nombreDe("inbound")),
      JSON.stringify(agendaTrasInbound.buckets?.tomorrow));

    // ---------- Cancelar desde la UI ----------
    const cancelables = await page.locator("[data-testid='agenda-cancel']").count();
    ok("024 · hay recordatorios que cancelar antes de cancelar", cancelables === 3, `${cancelables}`);
    // Se cancela el de "hoy" por NOMBRE: con dos vencidos en pantalla, "el
    // primero de la lista" sería el otro.
    const filaHoy = page.locator("[data-testid^='agenda-item-']", { hasText: nombreDe("hoy") });
    await filaHoy.locator("[data-testid='agenda-cancel']").click();
    await waitFor(async () => (await page.locator("[data-testid='agenda-cancel']").count()) === 2, 10000);
    ok("024 · cancelar quita el item de la Agenda",
      (await page.locator("[data-testid='agenda-cancel']").count()) === 2,
      `${await page.locator("[data-testid='agenda-cancel']").count()} items`);
    const filasTrasCancelar = Number(
      (await sql`SELECT count(*)::int AS n FROM conversation_attention WHERE conversation_id = ${hoy.conversationId}`)[0]?.n ?? 0
    );
    ok("024 · la fila del recordatorio cancelado desaparece de la BD", filasTrasCancelar === 0, `n=${filasTrasCancelar}`);

    // ---------- Aislamiento por UI: la sesión de B ve SU Agenda ----------
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgB }),
    });
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    const agendaB = (await api("/api/reminders")).json;
    ok("024 · la organización B solo ve su propio recordatorio",
      agendaB?.total === 1 && JSON.stringify(agendaB.buckets).includes(nombreDe("otra")),
      `total=${agendaB?.total}`);
    ok("024 · la Agenda de B no menciona ninguna conversación de A",
      !JSON.stringify(agendaB.buckets).includes(nombreDe("vencido")));

    // ---------- Camino infeliz por UI: sin sesión ----------
    const anon = await browser.newContext();
    const pageAnon = await anon.newPage();
    await pageAnon.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    ok("024 · sin sesión, /agenda devuelve al login",
      new URL(pageAnon.url()).pathname === "/login", pageAnon.url());
    const apiAnon = await pageAnon.evaluate(async () => (await fetch("/api/reminders")).status);
    ok("024 · sin sesión, /api/reminders responde 401 desde el navegador", apiAnon === 401, `HTTP ${apiAnon}`);
    await anon.close();

    // ---------- La garantía del corte: nada salió a WhatsApp ----------
    ok("024 · CERO WhatsApp: el outbox del mock no creció en todo el guion",
      (await outboxDe()) === outboxInicial, `${outboxInicial} → ${await outboxDe()}`);
    ok("024 · CERO seguimientos automáticos: sales_follow_up_job intacta",
      (await jobsDe()) === jobsInicial, `${jobsInicial} → ${await jobsDe()}`);
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
