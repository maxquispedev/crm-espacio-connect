/**
 * 013 C2 — Bandeja "Por atender": self-test de UI real (Playwright).
 *
 * Lo que se verifica, y por qué con la app viva y no con un test unitario:
 * la cola tiene que aparecer en la pantalla que el operador mira al abrir el
 * día, con el número correcto, y ese número tiene que cambiar al filtrar. Un
 * test de componente no prueba que la página monte, ni que el botón responda, ni
 * que el servidor sends el `attention` por el camino real.
 *
 * El fixture se siembra por SQL directo a propósito: los tres estados que hay
 * que ver en pantalla (vencido, futuro, esperando al cliente) incluyen el
 * "vencido", y waiting ese reloj implicaría dormir o esperar un cron. Con SQL
 * el escenario es determinista y no depende de que el worker de recordatorios
 * (intacto en este corte) ya haya corrido.
 *
 * Ejecutar: E2E_SECTION=023 node scripts/e2e-selftest.mjs, con la app viva,
 * WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL y OPENROUTER_BASE_URL apuntando a los
 * mocks locales, y una BD dedicada llamada operator_workspace_test[_...].
 */
export async function runOperatorQueueSelftest({ BASE, api, ok, waitFor, getCookie }) {
  console.log("\n== 013-c2-bandeja-cola: 023 · UI real + happy/unhappy ==");
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
      "023 requiere app y BD dedicadas locales (operator_workspace_test), WA_MOCK_ENABLED=true y entorno de desarrollo"
    );
  }
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`023 app/BD no saludables: HTTP ${health.status}`);

  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const { chromium } = await import("playwright");
  const previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
  const password = "password-e2e-123";
  const MIN = 60_000;
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
    ok("023 · sesión operador", login.res.ok);
    if (!login.res.ok) throw new Error("023 requiere el operador fixture e2e@vocero.test");

    const makeOrg = async (letter) => {
      const created = await api("/api/auth/organization/create", {
        method: "POST",
        body: JSON.stringify({ name: `Cola E2E ${letter}`, slug: `cola-023-${letter}-${Date.now()}` }),
      });
      ok(`023 · organización ${letter}`, created.res.ok && !!created.json?.id);
      if (!created.json?.id) throw new Error("023 no pudo crear organización de prueba");
      return created.json.id;
    };
    const orgA = await makeOrg("a");
    const orgB = await makeOrg("b");
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgA }),
    });

    // ---------- Fixture: una fila por situación de la cola ----------
    const stamp = Date.now();
    const nombreDe = (sufijo) => `Cola ${sufijo}`;
    /** Identidad única y estable por contacto: (organization_id, wa_identity) es UNIQUE. */
    const identidadDe = (sufijo) => {
      let hash = 0;
      for (const ch of `${stamp}:${sufijo}`) hash = (hash * 31 + ch.charCodeAt(0)) % 100000000;
      return `52${String(hash).padStart(10, "0")}`;
    };
    const sembrar = async ({ org, sufijo, state, minutos, unread = 0, esTest = false }) => {
      const contactId = `ct_023_${sufijo}_${stamp}`;
      const conversationId = `cv_023_${sufijo}_${stamp}`;
      await sql`INSERT INTO contact (id, organization_id, wa_identity, name)
        VALUES (${contactId}, ${org}, ${identidadDe(sufijo)}, ${nombreDe(sufijo)})`;
      await sql`INSERT INTO conversation
          (id, organization_id, contact_id, handoff_at, handoff_reason, ai_enabled, is_test, unread_count, created_at, updated_at)
        VALUES (${conversationId}, ${org}, ${contactId},
          ${state ? new Date() : null}, ${state ? "commercial" : null}, ${state ? false : true},
          ${esTest}, ${unread}, now(), now())`;
      if (state) {
        await sql`INSERT INTO conversation_attention
            (id, organization_id, conversation_id, state, due_at, note, created_at, updated_at)
          VALUES (${`ca_023_${sufijo}_${stamp}`}, ${org}, ${conversationId}, ${state},
            ${state === "deferred" ? new Date(Date.now() + minutos * MIN) : null},
            ${state === "deferred" ? "jueves 10:00" : null}, now(), now())`;
      }
      return conversationId;
    };

    const espera = await sembrar({ org: orgA, sufijo: "handoff", state: "pending" });
    const humano = await sembrar({ org: orgA, sufijo: "inbound", state: "pending" });
    const vencido = await sembrar({ org: orgA, sufijo: "vencido", state: "deferred", minutos: -30 });
    const futuro = await sembrar({ org: orgA, sufijo: "futuro", state: "deferred", minutos: 60 * 24 * 3 });
    const esperando = await sembrar({ org: orgA, sufijo: "esperando", state: "waiting_client", unread: 4 });
    const soloIa = await sembrar({ org: orgA, sufijo: "soloia", state: null });
    const anuncio = await sembrar({ org: orgA, sufijo: "anuncio", state: null, unread: 1 });
    const laboratorio = await sembrar({ org: orgA, sufijo: "lab", state: "pending", esTest: true });
    const deB = await sembrar({ org: orgB, sufijo: "otra", state: "pending" });

    // Etapas: una conversación en la cola y otra fuera, para ver que el filtro de
    // etapa acota la cola Y su conteo (no se toca su semántica: FR-2.6).
    await sql`INSERT INTO pipeline_stage (id, organization_id, name, position, kind, created_at)
      VALUES (${`st_023_i_${stamp}`}, ${orgA}, 'Interesado', 1, 'open', now()),
             (${`st_023_n_${stamp}`}, ${orgA}, 'Nuevo', 0, 'open', now())`;
    await sql`INSERT INTO lead (id, organization_id, contact_id, stage_id, position, created_at, updated_at)
      VALUES (${`ld_023_i_${stamp}`}, ${orgA}, ${`ct_023_handoff_${stamp}`}, ${`st_023_i_${stamp}`}, 0, now(), now()),
             (${`ld_023_n_${stamp}`}, ${orgA}, ${`ct_023_futuro_${stamp}`}, ${`st_023_n_${stamp}`}, 0, now(), now())`;
    // Anuncio: para que el chip "Anuncios" siga existiendo y siga contando igual.
    await sql`INSERT INTO ad_attribution
        (id, organization_id, contact_id, conversation_id, source_type, source_id, source_url, headline, ctwa_clid, created_at)
      VALUES (${`aa_023_${stamp}`}, ${orgA}, ${`ct_023_anuncio_${stamp}`}, ${anuncio},
        'ad', 'promo-1', NULL, 'Promo E2E', NULL, now())`;

    // ---------- Camino feliz por API: el DTO llega con la atención resuelta ----------
    const lista = await api("/api/conversations");
    const porNombre = new Map(
      (lista.json?.conversations ?? []).map((c) => [c.contact.name, c])
    );
    ok("023 · el Laboratorio (is_test) no está en la lista", !porNombre.has(nombreDe("lab")));
    ok("023 · 7 conversaciones reales de A (sin la de B)", porNombre.size === 7, `vistas: ${porNombre.size}`);
    ok(
      "023 · handoff: needsAttentionNow con los cuatro campos del plan §4.1",
      JSON.stringify(porNombre.get(nombreDe("handoff"))?.attention) ===
        JSON.stringify({ state: "pending", dueAt: null, note: null, needsAttentionNow: true }),
      JSON.stringify(porNombre.get(nombreDe("handoff"))?.attention)
    );
    ok(
      "023 · recordatorio vencido entra (deferred + due_at pasado)",
      porNombre.get(nombreDe("vencido"))?.attention?.needsAttentionNow === true
    );
    ok(
      "023 · recordatorio futuro NO entra (deferred + due_at por venir)",
      porNombre.get(nombreDe("futuro"))?.attention?.needsAttentionNow === false
    );
    ok(
      "023 · waiting_client NO entra aunque tenga 4 no leídas",
      porNombre.get(nombreDe("esperando"))?.attention?.needsAttentionNow === false &&
        porNombre.get(nombreDe("esperando"))?.unreadCount === 4
    );
    ok(
      "023 · sin estado humano: attention null (no false)",
      porNombre.get(nombreDe("soloia"))?.attention === null
    );

    // ---------- Camino infeliz por API: sin sesión y organización ajena ----------
    // Sin credenciales, y sin tocar la cookie del arnés: una petición pelada.
    const anonimo = await fetch(`${BASE}/api/conversations`, {
      headers: { origin: BASE },
    });
    ok(
      "023 · sin sesión, la lista responde 401",
      anonimo.status === 401,
      `HTTP ${anonimo.status}`
    );
    // Un GET a /api/conversations/[id] no existe (solo hay PATCH): el método no
    // se acepta. Lo que importa aquí es que la conversación de OTRA organización
    // es invisible, y eso se comprueba por la vía que sí existe.
    const metodoNoSoportado = await api(`/api/conversations/${deB}`);
    ok(
      "023 · GET a una conversación no está soportado (405, no expone datos)",
      metodoNoSoportado.res.status === 405,
      `HTTP ${metodoNoSoportado.res.status}`
    );
    const ajena = await api(`/api/conversations/${deB}`, {
      method: "PATCH",
      body: JSON.stringify({ aiEnabled: false }),
    });
    ok(
      "023 · PATCH sobre conversación de otra organización: 404 (no 403, no fuga)",
      ajena.res.status === 404,
      `HTTP ${ajena.res.status}`
    );
    const inexistente = await api("/api/conversations/cv_no_existe_023", {
      method: "PATCH",
      body: JSON.stringify({ markRead: true }),
    });
    ok(
      "023 · PATCH sobre conversación inexistente: 404",
      inexistente.res.status === 404,
      `HTTP ${inexistente.res.status}`
    );

    // ---------- Camino feliz por UI real ----------
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
    const nombresVisibles = async () => {
      await page.waitForTimeout(150);
      return page.$$eval("[data-testid='conversation-item']", (nodes) =>
        nodes.map((n) => n.textContent ?? "")
      );
    };
    // La Bandeja mantiene abierto el SSE de /api/events, así que "networkidle"
    // no llega nunca: se espera al DOM y luego a la fila, que es lo que importa.
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });

    // El número del chip se lee del texto, no de una cadena completa: el markup
    // pone la etiqueta y el contador como hermanos, sin separador.
    const numeroDe = async (locator) => {
      const match = ((await locator.textContent()) ?? "").replace(/\s+/g, " ").match(/(\d+)\s*$/);
      return match ? Number(match[1]) : NaN;
    };
    const chip = page.getByRole("button", { name: /Por atender/ });
    ok("023 · el chip 'Por atender' existe en la Bandeja", await chip.isVisible());
    const colaN = await numeroDe(chip);
    ok(
      "023 · el chip marca 3 (handoff + inbound humano + vencido)",
      colaN === 3,
      `chip=${colaN}`
    );

    // El chip va PRIMERO: antes de "Todas" y de "No leídas".
    const orden = await page.$$eval("button", (nodes) =>
      nodes.map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
    );
    const iCola = orden.findIndex((t) => t.startsWith("Por atender"));
    const iTodas = orden.findIndex((t) => t.startsWith("Todas"));
    const iSinLeer = orden.findIndex((t) => t.startsWith("No leídas"));
    ok(
      "023 · 'Por atender' es la primera opción de la fila de filtros",
      iCola >= 0 && iCola < iTodas && iTodas < iSinLeer,
      `posiciones cola=${iCola} todas=${iTodas} sin-leer=${iSinLeer}`
    );

    // Al pincharlo, la lista es exactamente la cola.
    await chip.click();
    await waitFor(
      async () => (await nombresVisibles()).every((t) => !t.includes("Cola futuro")),
      10000
    );
    const enCola = await nombresVisibles();
    ok("023 · la lista filtrada tiene 3 filas, igual que el chip", enCola.length === 3, `${enCola.length} filas`);
    ok(
      "023 · la cola contiene handoff, inbound y vencido",
      ["handoff", "inbound", "vencido"].every((s) => enCola.some((t) => t.includes(`Cola ${s}`))),
      enCola.join(" | ")
    );
    ok(
      "023 · la cola EXCLuye futuro, esperando al cliente, solo IA y anuncio",
      ["futuro", "esperando", "soloia", "anuncio"].every((s) => !enCola.some((t) => t.includes(`Cola ${s}`))),
      enCola.join(" | ")
    );

    // ---------- Los otros tres filtros conservan su semántica ----------
    const todasChip = page.getByRole("button", { name: /^Todas/ });
    ok(
      "023 · 'Todas' sigue contando las 7 reales",
      (await numeroDe(todasChip)) === 7,
      `todas=${await numeroDe(todasChip)}`
    );
    await todasChip.click();
    await page.waitForTimeout(250);
    const todas = await nombresVisibles();
    ok("023 · 'Todas' lista 7 y no la del Laboratorio", todas.length === 7 && !todas.some((t) => t.includes("lab")), `${todas.length} filas`);

    // unreadCount es por CONVERSACIÓN, no por mensaje: solo 'esperando' (4) y
    // 'anuncio' (1) tienen no leídas. Las dos están fuera de la cola, y eso es
    // justo lo que demuestra que leer no es atender.
    const sinLeerChip = page.getByRole("button", { name: /^No leídas/ });
    ok(
      "023 · 'No leídas' sigue contando 2 conversaciones (esperando + anuncio)",
      (await numeroDe(sinLeerChip)) === 2,
      `sin-leídas=${await numeroDe(sinLeerChip)}`
    );
    await sinLeerChip.click();
    await page.waitForTimeout(250);
    const sinLeer = await nombresVisibles();
    ok(
      "023 · 'No leídas' lista las dos con no leídas, y ninguna de la cola",
      sinLeer.length === 2 &&
        sinLeer.some((t) => t.includes("Cola esperando")) &&
        sinLeer.some((t) => t.includes("Cola anuncio")) &&
        !sinLeer.some((t) => t.includes("Cola vencido")),
      sinLeer.join(" | ")
    );

    // El chip de anuncios lleva aria-label, así que su nombre accesible NO es el
    // texto visible: se localiza por el label y se cuenta por su contenido.
    const anunciosChip = page.getByRole("button", { name: "Filtrar por anuncios" });
    ok("023 · el chip 'Anuncios' sigue existiendo", await anunciosChip.isVisible());
    ok("023 · 'Anuncios' cuenta 1", (await numeroDe(anunciosChip)) === 1, `anuncios=${await numeroDe(anunciosChip)}`);
    await anunciosChip.click();
    await page.waitForTimeout(250);
    const soloAnuncios = await nombresVisibles();
    ok("023 · 'Anuncios' lista solo el anuncio", soloAnuncios.length === 1 && soloAnuncios[0].includes("anuncio"), soloAnuncios.join(" | "));
    // Volver a "Por atender": el filtro sigue puesto y la cola intacta.
    await chip.click();
    await page.waitForTimeout(250);
    ok("023 · volver a la cola tras 'Anuncios' devuelve las 3", (await nombresVisibles()).length === 3);

    // Filtro de etapa: acota la lista Y el conteo del chip.
    const selectEtapa = page.getByLabel("Filtrar por etapa del embudo");
    if ((await selectEtapa.count()) > 0) {
      const opciones = await selectEtapa.locator("option").evaluateAll((os) => os.map((o) => o.value));
      if (opciones.includes("Interesado")) {
        await selectEtapa.selectOption("Interesado");
        await page.waitForTimeout(250);
        const etapa = await nombresVisibles();
        const colaEtapa = await numeroDe(chip);
        ok(
          "023 · por etapa 'Interesado' la cola queda en 1 y lista 1",
          etapa.length === 1 && colaEtapa === 1 && etapa[0].includes("Cola handoff"),
          `${etapa.length} filas · chip=${colaEtapa} · ${etapa.join(" | ")}`
        );
        await selectEtapa.selectOption("all");
        await page.waitForTimeout(250);
        ok(
          "023 · al volver a 'Toda etapa' la cola recupera 3",
          (await numeroDe(chip)) === 3,
          `chip=${await numeroDe(chip)}`
        );
      } else {
        ok("023 · el filtro de etapa existe con sus etapas", false, `opciones: ${opciones.join(",")}`);
      }
    } else {
      ok("023 · el filtro de etapa sigue presente", false, "no se encontró el <select> de etapa");
    }

    // ---------- Aislamiento por UI: la sesión de B ve SU cola ----------
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgB }),
    });
    // La Bandeja mantiene abierto el SSE de /api/events, así que "networkidle"
    // no llega nunca: se espera al DOM y luego a la fila, que es lo que importa.
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    const chipB = page.getByRole("button", { name: /Por atender/ });
    const colaB = await numeroDe(chipB);
    ok(
      "023 · la organización B ve su propia cola, no la de A",
      colaB === 1,
      `chip=${colaB}`
    );
    const filasB = await nombresVisibles();
    ok(
      "023 · B solo ve su conversación, ninguna de A",
      filasB.length === 1 && filasB[0].includes("otra"),
      filasB.join(" | ")
    );
    ok(
      "023 · B no ve la conversación de A por id (404 ya comprobado por API)",
      filasB.every((t) => !t.includes("handoff"))
    );

    // ---------- Camino infeliz por UI: sin sesión ----------
    const anon = await browser.newContext();
    const pageAnon = await anon.newPage();
    await pageAnon.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    ok(
      "023 · sin sesión, /inbox devuelve al login en vez de la bandeja",
      new URL(pageAnon.url()).pathname === "/login",
      pageAnon.url()
    );
    const apiAnon = await pageAnon.evaluate(async () => {
      const res = await fetch("/api/conversations");
      return res.status;
    });
    ok("023 · sin sesión, /api/conversations responde 401 desde el navegador", apiAnon === 401, `HTTP ${apiAnon}`);
    await anon.close();
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
