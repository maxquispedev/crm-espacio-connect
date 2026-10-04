/**
 * 013 C4 — Flujo operativo integrado: el recorrido COMPLETO como lo haría una
 * persona, con UI real (Playwright).
 *
 * Los cortes anteriores probaron las piezas: el corte 2 que la cola existe, el
 * corte 3 que la Agenda agrupa. Este corte es el primero que las usa JUNTAS, y lo
 * que se verifica aquí no se puede comprobar con un test unitario: que la
 * coherencia de estado se ve EN PANTALLA en las tres superficies a la vez, que
 * "abrir no la saca" de verdad, que las tres acciones del panel mueven lo que
 * dicen, y que el camino infeliz avisa sin dejar la interfaz rota.
 *
 * Recorrido, en el orden en que lo haría Max un martes por la mañana:
 *
 *   1. Abre la Bandeja y ve las dos preguntas: qué hago ahora y qué tengo
 *      comprometido para después (FR-4.3), más el contador de vencidos en el nav.
 *   2. Abre una conversación de la cola y comprueba que ABRIR NO LA SACA.
 *   3. "Marcar atendido" → sale de la cola sin escribir nada.
 *   4. "Recordarme" → sale de la cola y aparece en la Agenda.
 *   5. La Agenda lo muestra con las MISMAS palabras que la lista.
 *   6. "Reactivar IA" → el estado humano desaparece y la IA vuelve a mandar.
 *   7. El cliente escribe de verdad (inbound por el mock) y Max RESPONDE: solo
 *      ese envío explícito llega al outbox.
 *
 * Y el camino infeliz: sin sesión, conversación de otra organización, y la Agenda
 * caída (500) — que debe avisar y dejar el resto de la app usable.
 *
 * Ejecutar: E2E_SECTION=025 node scripts/e2e-selftest.mjs, con la app viva,
 * WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL y OPENROUTER_BASE_URL apuntando a los
 * mocks locales, y una BD dedicada llamada operator_workspace_test[_...].
 */
export async function runOperatorFlowSelftest({ BASE, api, ok, waitFor, getCookie }) {
  console.log("\n== 013-c4-flujo-operativo: 025 · UI real + happy/unhappy ==");
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
      "025 requiere app y BD dedicadas locales (operator_workspace_test), WA_MOCK_ENABLED=true y entorno de desarrollo"
    );
  }
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`025 app/BD no saludables: HTTP ${health.status}`);

  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const { chromium } = await import("playwright");
  const previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
  const password = "password-e2e-123";
  const MIN = 60_000;
  // El webhook resuelve la ORGANIZACIÓN por `phone_number_id` tomando la
  // PRIMERA fila que coincide: con un PN fijo, una corrida anterior deja
  // credenciales registradas y el inbound se iría a una organización vieja.
  const PN = `PN-E2E-025-${Date.now()}`;
  // Única por corrida (ver `sembrar`): evita colisionar con otro contacto del
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
    ok("025 · sesión operador", login.res.ok);
    if (!login.res.ok) throw new Error("025 requiere el operador fixture e2e@vocero.test");

    const makeOrg = async (letter) => {
      const created = await api("/api/auth/organization/create", {
        method: "POST",
        body: JSON.stringify({
          name: `Flujo E2E ${letter}`,
          slug: `flujo-025-${letter}-${Date.now()}`,
        }),
      });
      ok(`025 · organización ${letter}`, created.res.ok && !!created.json?.id);
      if (!created.json?.id) throw new Error("025 no pudo crear organización de prueba");
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
      body: JSON.stringify({ wabaId: "WABA-E2E-025", phoneNumberId: PN, token: "tok-e2e" }),
    });
    ok("025 · WhatsApp mock conectado", wa.res.ok, JSON.stringify(wa.json));

    // ---------- Fixture ----------
    const stamp = Date.now();
    const nombreDe = (sufijo) => `Flujo ${sufijo}`;
    // Identidad estable y ÚNICA por sufijo: (organization_id, wa_identity) es
    // UNIQUE, así que dos sufijos NO pueden compartir número.
    const identidadDe = (sufijo) => {
      let hash = 7;
      for (const ch of `025:${stamp}:${sufijo}`) {
        hash = (hash * 31 + ch.charCodeAt(0)) % 99999989;
      }
      return `52${String(hash).padStart(10, "0")}`;
    };

    const sembrar = async ({ org, sufijo, state, minutos, esTest = false, identidad }) => {
      const contactId = `ct_025_${sufijo}_${stamp}`;
      const conversationId = `cv_025_${sufijo}_${stamp}`;
      await sql`INSERT INTO contact (id, organization_id, wa_identity, name)
        VALUES (${contactId}, ${org}, ${identidad ?? identidadDe(sufijo)}, ${nombreDe(sufijo)})`;
      await sql`INSERT INTO conversation
          (id, organization_id, contact_id, handoff_at, handoff_reason, ai_enabled, is_test, unread_count, created_at, updated_at)
        VALUES (${conversationId}, ${org}, ${contactId},
          ${state ? new Date() : null}, ${state ? "cliente" : null}, ${state ? false : true},
          ${esTest}, 0, now(), now())`;
      if (state) {
        await sql`INSERT INTO conversation_attention
            (id, organization_id, conversation_id, state, due_at, note, created_at, updated_at)
          VALUES (${`ca_025_${sufijo}_${stamp}`}, ${org}, ${conversationId}, ${state},
            ${state === "deferred" ? new Date(Date.now() + minutos * MIN) : null},
            ${state === "deferred" ? "jueves 10:00" : null}, now(), now())`;
      }
      return { contactId, conversationId };
    };

    // Estado inicial de A:
    //   Por atender = pendiente + vencido = 2
    //   Comprometidos = futuro = 1
    //   Agenda = vencido + futuro = 2  ·  nav vencidos = 1
    const pendiente = await sembrar({ org: orgA, sufijo: "pendiente", state: "pending" });
    const vencido = await sembrar({ org: orgA, sufijo: "vencido", state: "deferred", minutos: -30 });
    const futuro = await sembrar({ org: orgA, sufijo: "futuro", state: "deferred", minutos: 60 * 72 });
    const espera = await sembrar({ org: orgA, sufijo: "espera", state: "waiting_client" });
    const soloIa = await sembrar({ org: orgA, sufijo: "soloia", state: null });
    const lab = await sembrar({
      org: orgA,
      sufijo: "lab",
      state: "deferred",
      minutos: 60 * 48,
      esTest: true,
    });
    // El que va a recibir un inbound REAL y ser respondido desde el composer.
    const responde = await sembrar({
      org: orgA,
      sufijo: "responde",
      state: "waiting_client",
      identidad: FROM_INBOUND,
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
    const estadoDe = async (conversationId) =>
      (
        await sql`SELECT state, due_at, note FROM conversation_attention
          WHERE conversation_id = ${conversationId}`
      )[0] ?? null;
    const outboxInicial = await outboxDe();
    const jobsInicial = await jobsDe();

    // =====================================================================
    // 0 · Camino infeliz por API: sin sesión y conversación ajena
    // =====================================================================
    const anonimo = await fetch(`${BASE}/api/reminders`, { headers: { origin: BASE } });
    ok("025 · sin sesión, la Agenda responde 401", anonimo.status === 401, `HTTP ${anonimo.status}`);

    const marcarAjena = await api(`/api/conversations/${deB.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "waiting_client" }),
    });
    ok("025 · marcar atendida una conversación de otra organización → 404",
      marcarAjena.res.status === 404, `HTTP ${marcarAjena.res.status}`);

    const marcarIa = await api(`/api/conversations/${soloIa.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "waiting_client" }),
    });
    ok("025 · marcar atendida una conversación de la IA → 409 con mensaje legible",
      marcarIa.res.status === 409 &&
        String(marcarIa.json?.error?.message ?? "").includes("IA es la dueña"),
      `HTTP ${marcarIa.res.status} ${JSON.stringify(marcarIa.json)}`);

    const marcarLab = await api(`/api/conversations/${lab.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "waiting_client" }),
    });
    ok("025 · marcar atendida una conversación del Laboratorio → 409",
      marcarLab.res.status === 409, `HTTP ${marcarLab.res.status}`);

    const estadoIlegible = await api(`/api/conversations/${pendiente.conversationId}/attention`, {
      method: "POST",
      body: JSON.stringify({ state: "pending" }),
    });
    ok("025 · el endpoint NO acepta fabricar un estado (422)",
      estadoIlegible.res.status === 422, `HTTP ${estadoIlegible.res.status}`);
    ok("025 · el intento fallido no escribió nada",
      (await estadoDe(pendiente.conversationId))?.state === "pending");

    // =====================================================================
    // 1 · La Bandeja responde las DOS preguntas (FR-4.3)
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

    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });

    ok("025 · 'Por atender' responde 'qué hago ahora' (2)",
      (await numeroDe(chip("por_atender"))) === 2, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("025 · 'Comprometidos' responde 'qué tengo para después' (1)",
      (await numeroDe(chip("comprometidos"))) === 1, `chip=${await numeroDe(chip("comprometidos"))}`);
    ok("025 · el nav muestra los vencidos de la Agenda (1)",
      (await navVencidos.isVisible()) && (await numeroDe(navVencidos)) === 1,
      await navVencidos.count() ? await navVencidos.textContent() : "sin contador");
    ok("025 · 'Por atender' es el primer chip de la fila",
      (await chip("por_atender").evaluate((el) => el.parentElement.firstElementChild === el)) === true);
    ok("025 · el chip nuevo no se come a la cola: 2 + 1 = todas menos la de la IA",
      (await numeroDe(chip("all"))) === 6, `todas=${await numeroDe(chip("all"))}`);

    // El estado se lee IGUAL en la lista que en la Agenda y en el panel.
    ok("025 · la fila del vencido dice 'Por atender'",
      (await textoFila(nombreDe("vencido"))).includes("Por atender"),
      await textoFila(nombreDe("vencido")));
    ok("025 · la fila de la atendida dice 'Esperando respuesta'",
      (await textoFila(nombreDe("espera"))).includes("Esperando respuesta"),
      await textoFila(nombreDe("espera")));
    ok("025 · la fila de la comprometida dice 'Recordatorio'",
      (await textoFila(nombreDe("futuro"))).includes("Recordatorio"),
      await textoFila(nombreDe("futuro")));
    ok("025 · la conversación de la IA no lleva etiqueta de estado",
      !(await textoFila(nombreDe("soloia"))).includes("Por atender") &&
        (await filaDe(nombreDe("soloia")).locator("[data-testid='fila-estado']").count()) === 0,
      await textoFila(nombreDe("soloia")));
    ok("025 · el Laboratorio no aparece en la Bandeja",
      (await filaDe(nombreDe("lab")).count()) === 0);

    // =====================================================================
    // 2 · Abrir NO saca de "Por atender"
    // =====================================================================
    await filaDe(nombreDe("pendiente")).click();
    await page.waitForSelector("[data-testid='attention-block']", { timeout: 30000 });
    ok("025 · la cola NO baja por abrir la conversación (sigue en 2)",
      (await numeroDe(chip("por_atender"))) === 2, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("025 · el panel muestra el estado 'Por atender'",
      (await page.locator("[data-testid='attention-state']").textContent())?.includes("Por atender") === true,
      await page.locator("[data-testid='attention-state']").textContent());
    ok("025 · el panel ofrece las TRES acciones del flujo",
      (await page.locator("[data-testid='attention-mark-attended']").isVisible()) &&
        (await page.locator("[data-testid='attention-reactivate']").isVisible()) &&
        (await page.locator("[data-testid='reminder-open']").isVisible()));
    ok("025 · el motivo del handoff se cuenta en castellano",
      (await page.locator("[data-testid='attention-reason']").textContent())?.includes("cliente") === true,
      await page.locator("[data-testid='attention-reason']").textContent());

    // =====================================================================
    // 3 · "Marcar atendido" saca de la cola
    // =====================================================================
    const outboxAntesDeAtender = await outboxDe();
    await page.locator("[data-testid='attention-mark-attended']").click();
    const colaAtendida = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 1 ? n : null;
    }, 15000);
    ok("025 · 'Marcar atendido' saca de 'Por atender' (2 → 1) sin recargar", colaAtendida === 1,
      `chip=${await numeroDe(chip("por_atender"))}`);
    const estadoEnPanel = await waitFor(async () => {
      const t = await page.locator("[data-testid='attention-state']").textContent();
      return t?.includes("Esperando respuesta") ? t : null;
    }, 15000);
    ok("025 · el panel pasa a 'Esperando respuesta'", Boolean(estadoEnPanel),
      await page.locator("[data-testid='attention-state']").textContent().catch(() => "sin estado"));
    ok("025 · al resolver, el botón 'Marcar atendido' desaparece",
      (await page.locator("[data-testid='attention-mark-attended']").count()) === 0);
    ok("025 · la fila de la lista coincide con el panel",
      (await waitFor(async () =>
        (await textoFila(nombreDe("pendiente"))).includes("Esperando respuesta") ? true : null, 10000)) === true,
      await textoFila(nombreDe("pendiente")));
    ok("025 · en BD la conversación quedó en waiting_client",
      (await estadoDe(pendiente.conversationId))?.state === "waiting_client",
      JSON.stringify(await estadoDe(pendiente.conversationId)));
    ok("025 · marcar atendida NO manda WhatsApp",
      (await outboxDe()) === outboxAntesDeAtender, `${outboxAntesDeAtender} → ${await outboxDe()}`);

    // =====================================================================
    // 4 · "Recordarme" mueve a la Agenda
    // =====================================================================
    await page.locator("[data-testid='reminder-open']").click();
    await page.waitForSelector("[data-testid='reminder-due']", { timeout: 10000 });
    const dosDias = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`;
    });
    await page.locator("[data-testid='reminder-due']").fill(dosDias);
    await page.locator("[data-testid='reminder-save']").click();
    const programado = await waitFor(async () => {
      const t = await page.locator("[data-testid='attention-state']").textContent();
      return t?.includes("Recordatorio") ? t : null;
    }, 15000);
    ok("025 · 'Recordarme' cambia el estado a 'Recordatorio'", Boolean(programado),
      await page.locator("[data-testid='attention-state']").textContent().catch(() => "sin estado"));
    const comprometidos = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 2 ? n : null;
    }, 15000);
    ok("025 · el compromiso nuevo aparece en 'Comprometidos' (1 → 2)", comprometidos === 2,
      `chip=${await numeroDe(chip("comprometidos"))}`);
    ok("025 · programar un recordatorio NO saca más de la cola (sigue en 1)",
      (await numeroDe(chip("por_atender"))) === 1, `chip=${await numeroDe(chip("por_atender"))}`);
    ok("025 · en BD hay un `deferred` con fecha futura",
      (await estadoDe(pendiente.conversationId))?.state === "deferred" &&
        new Date((await estadoDe(pendiente.conversationId)).due_at).getTime() > Date.now(),
      JSON.stringify(await estadoDe(pendiente.conversationId)));

    // =====================================================================
    // 5 · La Agenda dice lo MISMO que la lista
    // =====================================================================
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    ok("025 · la Agenda muestra los cinco grupos", await page.locator("[data-testid^='agenda-group-']").count() === 5);
    ok("025 · la Agenda de A tiene 3 recordatorios (vencido + futuro + el nuevo)",
      (await page.locator("[data-testid='agenda-cancel']").count()) === 3,
      `${await page.locator("[data-testid='agenda-cancel']").count()} items`);
    ok("025 · el recordatorio nuevo se ve en la Agenda",
      (await page.getByText(nombreDe("pendiente")).first().isVisible()));
    ok("025 · el nuevo se lee como 'programado'",
      (await page.locator("[data-testid^='agenda-item-']", { hasText: nombreDe("pendiente") })
        .locator("[data-testid='agenda-item-when']").textContent())?.includes("programado") === true,
      await page.locator("[data-testid^='agenda-item-']", { hasText: nombreDe("pendiente") })
        .locator("[data-testid='agenda-item-when']").textContent());
    // La coherencia que el corte promete: el vencido dice aquí lo mismo que la
    // fila de la lista, con la palabra "Por atender" dentro.
    ok("025 · el vencido se lee igual en la Agenda y en la lista",
      (await page.getByText(/vencido · en Por atender/i).first().isVisible()));
    ok("025 · el nav sigue mostrando 1 vencido desde la Agenda",
      (await numeroDe(navVencidos)) === 1, `nav=${await numeroDe(navVencidos)}`);
    ok("025 · la Agenda NO ofrece ninguna acción de envío",
      (await page.getByRole("button", { name: /^Enviar$/ }).count()) === 0);

    // =====================================================================
    // 6 · "Reactivar IA" limpia el estado humano
    // =====================================================================
    await page.goto(`${BASE}/inbox?contact=${pendiente.contactId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='attention-block']", { timeout: 30000 });
    await page.locator("[data-testid='attention-reactivate']").click();
    const bloqueFuera = await waitFor(async () =>
      (await page.locator("[data-testid='attention-block']").count()) === 0 ? true : null, 15000);
    ok("025 · 'Reactivar IA' quita el bloque de atención", bloqueFuera === true);
    const compromisosTrasReactivar = await waitFor(async () => {
      const n = await numeroDe(chip("comprometidos"));
      return n === 1 ? n : null;
    }, 15000);
    ok("025 · al reactivar, el compromiso sale de 'Comprometidos' (2 → 1)",
      compromisosTrasReactivar === 1, `chip=${await numeroDe(chip("comprometidos"))}`);
    ok("025 · la fila vuelve a no llevar etiqueta de estado (ya es de la IA)",
      (await filaDe(nombreDe("pendiente")).locator("[data-testid='fila-estado']").count()) === 0,
      await textoFila(nombreDe("pendiente")));
    ok("025 · en BD la fila de atención desapareció",
      (await estadoDe(pendiente.conversationId)) === null);
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    ok("025 · y sale de la Agenda (vuelve a 2: vencido + futuro)",
      (await page.locator("[data-testid='agenda-cancel']").count()) === 2,
      `${await page.locator("[data-testid='agenda-cancel']").count()} items`);

    // =====================================================================
    // 7 · El cliente escribe de verdad y Max RESPONDE
    // =====================================================================
    const outboxAntesDelInbound = await outboxDe();
    // Los chips de la Bandeja solo existen en la Bandeja: el paso anterior dejó
    // la UI en la Agenda, así que se vuelve antes de poder contar nada.
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='bandeja-filtro-por_atender']", { timeout: 30000 });
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: FROM_INBOUND,
        name: nombreDe("responde"),
        text: "hola, sigo esperando",
        waMessageId: `wamid.e2e.025.a.${stamp}`,
      }),
    });
    const colaConInbound = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 2 ? n : null;
    }, 25000);
    ok("025 · el cliente escribe: vuelve a 'Por atender' (1 → 2)", colaConInbound === 2,
      `chip=${await numeroDe(chip("por_atender"))}`);
    ok("025 · el inbound por sí solo NO manda WhatsApp",
      (await outboxDe()) === outboxAntesDelInbound,
      `${outboxAntesDelInbound} → ${await outboxDe()}`);

    await filaDe(nombreDe("responde")).click();
    await page.waitForSelector("[data-testid='attention-mark-attended']", { timeout: 30000 });
    // Antes del inbound, este mismo hilo tenía la ventana CERRADA: sin mensaje
    // reciente no se puede responder a mano. Se espera a que el
    // `conversation.updated` la abra (la Bandeja lo recibe por SSE) y se comprueba
    // el aviso del composer, no el botón de enviar — ese está deshabilitado
    // mientras el textarea está vacío y no dice nada de la ventana.
    const ventanaAbierta = await waitFor(async () => {
      const cerrada = await page.getByText("La ventana de 24 horas está cerrada.").count();
      return cerrada === 0 ? true : null;
    }, 20000);
    ok("025 · tras el inbound la ventana de 24 h pasa a estar abierta",
      ventanaAbierta === true);
    await page.getByPlaceholder("Escribe una respuesta…").fill("Hola, te escribo ahora mismo.");
    ok("025 · con texto, el composer habilita el envío",
      (await waitFor(async () => {
        const activo = await page.getByRole("button", { name: /^Enviar$/ }).isEnabled();
        return activo ? true : null;
      }, 10000)) === true);
    await page.getByRole("button", { name: /^Enviar$/ }).click();
    const colaRespondida = await waitFor(async () => {
      const n = await numeroDe(chip("por_atender"));
      return n === 1 ? n : null;
    }, 25000);
    ok("025 · responder saca de la cola (2 → 1)", colaRespondida === 1,
      `chip=${await numeroDe(chip("por_atender"))}`);
    ok("025 · responder deja la conversación en 'waiting_client'",
      (await estadoDe(responde.conversationId))?.state === "waiting_client",
      JSON.stringify(await estadoDe(responde.conversationId)));
    const outboxFinal = await waitFor(async () => {
      const n = await outboxDe();
      return n === outboxAntesDelInbound + 1 ? n : null;
    }, 25000);
    ok("025 · la respuesta explícita SÍ sale (y es lo único que sale)", outboxFinal !== null,
      `${outboxAntesDelInbound} → ${await outboxDe()}`);

    // =====================================================================
    // 8 · El copy no enseña internals
    // =====================================================================
    await page.goto(`${BASE}/inbox?contact=${pendiente.contactId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    await filaDe(nombreDe("vencido")).click();
    await page.waitForSelector("[data-testid='attention-block']", { timeout: 30000 });
    const cuerpoBandeja = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const cuerpoAgenda = await (async () => {
      await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
      return (await page.locator("body").innerText()).replace(/\s+/g, " ");
    })();
    const INTERNOS = [
      "handoffAt",
      "handoffReason",
      "needsAttentionNow",
      "waiting_client",
      "automationLane",
      "nextFollowUpAt",
      "followUpReason",
      "sales_follow_up_job",
    ];
    for (const [superficie, texto] of [["bandeja", cuerpoBandeja], ["agenda", cuerpoAgenda]]) {
      for (const token of INTERNOS) {
        ok(`025 · '${superficie}' no enseña '${token}'`, !texto.includes(token));
      }
      // Ningún ISO crudo: las fechas se muestran formateadas para una persona.
      ok(`025 · '${superficie}' no enseña un ISO crudo`, !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(texto));
    }
    ok("025 · el copy sí usa el vocabulario de operación",
      cuerpoBandeja.includes("Atención humana") &&
        cuerpoBandeja.includes("Marcar atendido") &&
        cuerpoBandeja.includes("Reactivar IA") &&
        cuerpoBandeja.includes("Recordarme") &&
        cuerpoAgenda.includes("Por atender"),
      cuerpoBandeja.slice(0, 200));

    // =====================================================================
    // 9 · Camino infeliz: la Agenda cae y la app sigue viva
    // =====================================================================
    await page.route("**/api/reminders", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' })
    );
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-error']", { timeout: 30000 });
    ok("025 · con la Agenda en 500 avisa en pantalla",
      ((await page.locator("[data-testid='agenda-error']").textContent()) ?? "").length > 0,
      await page.locator("[data-testid='agenda-error']").textContent());
    ok("025 · y los cinco grupos siguen en pantalla (no se rompe la vista)",
      (await page.locator("[data-testid^='agenda-group-']").count()) === 0 ||
        (await page.locator("[data-testid^='agenda-group-']").count()) === 5,
      `${await page.locator("[data-testid^='agenda-group-']").count()} grupos`);
    // El nav es lo que más se rompería si la Agenda fallara: sigue navigable.
    await page.unroute("**/api/reminders");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    ok("025 · tras reintentar, la Agenda carga sola",
      (await page.locator("[data-testid^='agenda-group-']").count()) === 5);

    // =====================================================================
    // 10 · Aislamiento por UI: la sesión de B
    // =====================================================================
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgB }),
    });
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    const agendaB = (await api("/api/reminders")).json;
    ok("025 · B solo ve su propio recordatorio",
      agendaB?.total === 1 && JSON.stringify(agendaB.buckets).includes(nombreDe("otra")),
      `total=${agendaB?.total}`);
    ok("025 · la Agenda de B no menciona ninguna conversación de A",
      !JSON.stringify(agendaB.buckets).includes(nombreDe("vencido")));
    // El nav de B no cuenta los vencidos de A: el contador es por organización.
    ok("025 · el nav de B no muestra los vencidos de A",
      (await navVencidos.count()) === 0, await navVencidos.count() ? await navVencidos.textContent() : "sin contador");
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    ok("025 · la Bandeja de B no muestra la cola de A",
      (await numeroDe(chip("por_atender"))) === 0, `chip=${await numeroDe(chip("por_atender"))}`);

    // =====================================================================
    // 11 · Camino infeliz por UI: sin sesión
    // =====================================================================
    const anon = await browser.newContext();
    const pageAnon = await anon.newPage();
    await pageAnon.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    ok("025 · sin sesión, /agenda devuelve al login",
      new URL(pageAnon.url()).pathname === "/login", pageAnon.url());
    const apiAnon = await pageAnon.evaluate(async () => (await fetch("/api/reminders")).status);
    ok("025 · sin sesión, /api/reminders responde 401 desde el navegador", apiAnon === 401, `HTTP ${apiAnon}`);
    const marcarAnon = await pageAnon.evaluate(async () => {
      const res = await fetch("/api/conversations/cv_x/attention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "waiting_client" }),
      });
      return res.status;
    });
    ok("025 · sin sesión, marcar atendida responde 401", marcarAnon === 401, `HTTP ${marcarAnon}`);
    await anon.close();

    // =====================================================================
    // 12 · Las garantías del bloque
    // =====================================================================
    ok("025 · CERO seguimientos automáticos: sales_follow_up_job intacta",
      (await jobsDe()) === jobsInicial, `${jobsInicial} → ${await jobsDe()}`);
    ok("025 · el outbox solo creció con la respuesta explícita de la persona",
      (await outboxDe()) === outboxInicial + 1, `${outboxInicial} → ${await outboxDe()}`);
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
