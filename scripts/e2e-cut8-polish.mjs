/**
 * 014 C8 — El cierre del workspace: pulido y REGRESIÓN, con UI real.
 *
 * Los cortes 1–7 dejaron el producto funcionando. Este corte no añade
 * funcionalidad: revisa lo que ya existe y lo deja presentable y operable. Por eso
 * esta sección no prueba que "se vea bien" —eso no se automatiza— sino las cuatro
 * cosas que un pulido puede romper en silencio y que aquí se comprueban en la app
 * real, en un móvil real (viewport de 375 px) y con teclado real:
 *
 *   1. **FR-8.1 · Responsive.** El shell tenía un `<aside>` de 224 px fijos y la
 *      Bandeja pedía 360 px de lista al lado: por debajo de ~900 px el producto
 *      era inusable. Aquí se comprueba que en 375 px el nav es un cajón que abre y
 *      cierra, y que la Bandeja va lista → hilo → detalles y vuelve.
 *   2. **FR-8.2 · Accesibilidad.** El anillo de foco era solo de `Button`/`Input`/
 *      `Textarea`: los enlaces del nav, los chips, las filas y las TRES acciones de
 *      013 dependían del anillo por defecto, que se recorta dentro de cualquier
 *      contenedor con `overflow`. Aquí se comprueba que al tabular se pinta un
 *      anillo real, que las acciones se alcanzan con teclado y que los avisos de
 *      esas acciones se ANUNCIAN (`role="status"`/`role="alert"`).
 *   3. **FR-8.3 · Estados.** Antes, si `/api/conversations` fallaba, la lista se
 *      quedaba en "Cargando…" PARA SIEMPRE, y si `/api/pipeline/board` fallaba el
 *      tablero affirming que "no tiene etapas" —un hecho falso sobre el negocio,
 *      con un "Gestionar etapas" que no arreglaba nada. Aquí se rompen las dos
 *      rutas y se comprueba que la pantalla avisa y se recupera.
 *   4. **Regresión.** Al final, la operación normal sigue igual de bien: la cola
 *      cuenta lo que debe, "Marcar atendido" saca, y el bot NO se manda a Graph.
 *
 * Y dos caminos infelices que este corte именно hacía silenciosos:
 * "Reactivar IA" fallaba sin decir nada, y "Recordarme" no decía si se guardó.
 *
 * Ejecutar: E2E_SECTION=027 node scripts/e2e-selftest.mjs, con la app viva,
 * WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL y OPENROUTER_BASE_URL apuntando a los
 * mocks locales, y una BD dedicada llamada operator_workspace_test[_...].
 */
export async function runCut8PolishSelftest({ BASE, api, ok, waitFor, getCookie }) {
  console.log("\n== 014-c8-cierre: 027 · pulido + regresión en UI real ==");
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
      "027 requiere app y BD dedicadas locales (operator_workspace_test), WA_MOCK_ENABLED=true y entorno de desarrollo"
    );
  }
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`027 app/BD no saludables: HTTP ${health.status}`);

  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const { chromium } = await import("playwright");
  const previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
  const password = "password-e2e-123";
  const MIN = 60_000;
  const stamp = Date.now();
  let browser;

  try {
    await sql`SELECT 1`;

    // ---------- Sesión y organización ----------
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
    ok("027 · sesión operador", login.res.ok);
    if (!login.res.ok) throw new Error("027 requiere el operador fixture e2e@vocero.test");

    const creada = await api("/api/auth/organization/create", {
      method: "POST",
      body: JSON.stringify({
        name: "Pulido E2E",
        slug: `pulido-027-${stamp}`,
      }),
    });
    ok("027 · organización propia", creada.res.ok && !!creada.json?.id);
    if (!creada.json?.id) throw new Error("027 no pudo crear la organización de prueba");
    const org = creada.json.id;
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: org }),
    });
    // WhatsApp al mock: sin canal no hay outbox que espiar.
    const wa = await api("/api/settings/whatsapp", {
      method: "PUT",
      body: JSON.stringify({
        wabaId: "WABA-E2E-027",
        phoneNumberId: `PN-E2E-027-${stamp}`,
        token: "tok-e2e",
      }),
    });
    ok("027 · WhatsApp mock conectado", wa.res.ok, JSON.stringify(wa.json));

    // ---------- Fixture: una conversación con trabajo pendiente ----------
    const nombre = "Pulido Ana";
    const contactId = `ct_027_${stamp}`;
    const conversationId = `cv_027_${stamp}`;
    await sql`INSERT INTO contact (id, organization_id, wa_identity, name)
      VALUES (${contactId}, ${org}, ${`52${stamp}`.slice(0, 12)}, ${nombre})`;
    await sql`INSERT INTO conversation
        (id, organization_id, contact_id, handoff_at, handoff_reason, ai_enabled, is_test, unread_count, created_at, updated_at)
      VALUES (${conversationId}, ${org}, ${contactId}, now(), 'cliente', false, false, 1, now(), now())`;
    await sql`INSERT INTO conversation_attention
        (id, organization_id, conversation_id, state, due_at, note, created_at, updated_at)
      VALUES (${`ca_027_${stamp}`}, ${org}, ${conversationId}, 'pending', null, null, now(), now())`;
    ok("027 · fixture: una conversación en 'Por atender'", true);

    const outboxDe = async () =>
      ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
    const jobsDe = async () =>
      Number(
        (
          await sql`SELECT count(*)::int AS n FROM sales_follow_up_job j
            JOIN conversation c ON c.id = j.conversation_id
            WHERE c.organization_id = ${org}`
        )[0]?.n ?? 0
      );
    const outboxInicial = await outboxDe();
    const jobsInicial = await jobsDe();

    // =====================================================================
    // 0 · ESCRITORIO: que el rediseño siga en pie
    // =====================================================================
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const jar = (getCookie() ?? "").split("; ").filter(Boolean);
    await context.addCookies(
      jar.map((entry) => {
        const split = entry.indexOf("=");
        return { name: entry.slice(0, split), value: entry.slice(split + 1), url: BASE };
      })
    );
    const page = await context.newPage();

    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });

    // --- 1 · El foco se ve de verdad ---
    // Se mide el anillo REALMENTE PINTADO, no "que el elemento existe": lo que se
    // comprueba es `outline-width` en :focus-visible. Antes esto daba 0 en todo lo
    // que no fuera `Button`/`Input`/`Textarea`.
    const anillo = async (locator) => {
      await locator.focus();
      return locator.evaluate((el) => {
        el.focus();
        const estilo = getComputedStyle(el);
        return { width: estilo.outlineWidth, estilo: estilo.outlineStyle, color: estilo.outlineColor };
      });
    };
    const navAgenda = page.locator("nav a", { hasText: "Agenda" }).first();
    const anchoNav = await anillo(navAgenda);
    ok("027 · el enlace del nav pinta un anillo de foco real",
      parseFloat(anchoNav.width) > 0 && anchoNav.estilo !== "none",
      `outline=${anchoNav.width} ${anchoNav.estilo}`);

    const chip = page.locator("[data-testid='bandeja-filtro-por_atender']");
    const anchoChip = await anillo(chip);
    ok("027 · el chip 'Por atender' pinta un anillo de foco real",
      parseFloat(anchoChip.width) > 0 && anchoChip.estilo !== "none",
      `outline=${anchoChip.width} ${anchoChip.estilo}`);

    // El anillo va DENTRO (desplazamiento negativo): dentro de un contenedor con
    // `overflow`, un anillo por fuera se recorta y no se ve nada.
    const desplazamiento = await chip.evaluate((el) => {
      el.focus();
      return getComputedStyle(el).outlineOffset;
    });
    ok("027 · el anillo va dentro de la caja, para que no lo recorte el scroll",
      parseFloat(desplazamiento) < 0, `outline-offset=${desplazamiento}`);

    // --- 2 · La cola y las tres acciones, intactas (regresión de 013) ---
    const numeroDe = async (locator) => {
      const match = ((await locator.textContent()) ?? "").replace(/\s+/g, " ").match(/(\d+)\s*$/);
      return match ? Number(match[1]) : NaN;
    };
    ok("027 · regresión: 'Por atender' cuenta 1",
      (await numeroDe(page.locator("[data-testid='bandeja-filtro-por_atender']"))) === 1);
    const fila = page.locator("[data-testid='conversation-item']", { hasText: nombre });
    ok("027 · regresión: la fila conserva la marca roja de trabajo",
      (await fila.count()) === 1 &&
        ((await fila.locator("..").textContent()) ?? "").includes("Por atender"));

    await fila.click();
    await page.waitForSelector("[data-testid='attention-block']", { timeout: 30000 });
    ok("027 · regresión: el panel ofrece las tres acciones",
      (await page.locator("[data-testid='attention-mark-attended']").isVisible()) &&
        (await page.locator("[data-testid='attention-reactivate']").isVisible()) &&
        (await page.locator("[data-testid='reminder-open']").isVisible()));

    // --- 3 · Las acciones se alcanzan con TECLADO y se anuncian ---
    // "Recordarme": al abrirlo, el foco tiene que caer en la fecha. Antes el
    // formulario se desplegaba y el foco se quedaba en el botón, así que había
    // que recorrer el panel a ciegas para llegar al campo.
    await page.locator("[data-testid='reminder-open']").click();
    await page.waitForSelector("[data-testid='reminder-due']", { timeout: 15000 });
    const focoEnFecha = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid")
    );
    ok("027 · al abrir 'Recordarme' el foco cae en la fecha",
      focoEnFecha === "reminder-due", `foco=${focoEnFecha}`);
    ok("027 · 'Elegir fecha' declara que lo abrió",
      (await page.locator("[data-testid='reminder-open']").getAttribute("aria-expanded")) === "true");
    await page.locator("[data-testid='reminder-open']").click();
    ok("027 · y declara que lo cerró",
      (await page.locator("[data-testid='reminder-open']").getAttribute("aria-expanded")) === "false");

    // "Marcar atendido": el resultado se ANUNCIA, no aparece en silencio.
    await page.locator("[data-testid='attention-mark-attended']").click();
    const hecho = await page.waitForSelector("[data-testid='attention-done']", { timeout: 20000 });
    ok("027 · 'Marcar atendido' anuncia que salió bien", !!hecho);
    ok("027 · ... y lo anuncia como estado, no como error",
      (await page.locator("[data-testid='attention-done']").getAttribute("role")) === "status");
    // El refetch de la lista es asíncrono: se espera a que la cola baje en vez de
    // leer el número en el mismo tick del clic (y que no sea un falso negativo).
    const bajoLaCola = await waitFor(async () =>
      (await numeroDe(page.locator("[data-testid='bandeja-filtro-por_atender']"))) === 0, 20000
    );
    ok("027 · regresión: sale de 'Por atender' al marcar atendida", !!bajoLaCola,
      `chip=${await numeroDe(page.locator("[data-testid='bandeja-filtro-por_atender']"))}`);

    // =====================================================================
    // 4 · CAMINO INFELIZ: "Reactivar IA" que falla EN SILENCIO (el defecto)
    // =====================================================================
    // Este es el fallo que el corte 1–7 dejó: el resultado del PATCH se
    // descartaba, el botón se quedaba pulsado y no pasaba nada ni se decía nada.
    // Ahora tiene que decir que no pudo, y decir el motivo del servidor.

    await page.route("**/api/conversations/*", async (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"error":{"message":"Se cayó el servidor"}}',
        });
      }
      return route.continue();
    });
    await page.locator("[data-testid='attention-reactivate']").click();
    const fallo = await page.waitForSelector("[data-testid='attention-error']", { timeout: 20000 });
    ok("027 · 'Reactivar IA' que falla lo DICE (antes fallaba en silencio)", !!fallo);
    ok("027 · ... con el mensaje del servidor, no un texto genérico",
      ((await page.locator("[data-testid='attention-error']").textContent()) ?? "").includes("Se cayó"));
    ok("027 · ... y lo anuncia como error",
      (await page.locator("[data-testid='attention-error']").getAttribute("role")) === "alert");
    // Y no se ha movido nada: el fallo no se disfraza de éxito.
    ok("027 · ... y la conversación sigue siendo del humano",
      await page.locator("[data-testid='attention-block']").isVisible());
    await page.unroute("**/api/conversations/*");
    // El aviso NO se borra solo al dejar de fallar: se queda hasta el siguiente
    // intento, que es lo que se quiere (si el reintento hubiera funcionado sin
    // que nadie volviera a pulsar, el aviso anterior no habría servido de nada).
    // Por eso aquí no se espera a que desaparezca: el clic siguiente lo limpia.

    // El camino feliz, y su consecuencia REAL: al reactivar, la conversación deja
    // de ser humana, así que el bloque entero desaparece —que es lo correcto— y su
    // garantía se comprueba en la base, no en un texto que ya no está en pantalla.
    await page.locator("[data-testid='attention-reactivate']").click();
    const bloqueFuera = await waitFor(async () =>
      (await page.locator("[data-testid='attention-block']").count()) === 0, 20000
    );
    ok("027 · 'Reactivar IA' saca el bloque de atención humana", !!bloqueFuera);
    const trasReactivar =
      (await sql`SELECT handoff_at, ai_enabled FROM conversation WHERE id = ${conversationId}`)[0];
    ok("027 · ... y la IA vuelve a mandar de verdad en la base",
      trasReactivar?.handoff_at === null && trasReactivar?.ai_enabled === true,
      JSON.stringify(trasReactivar));

    // =====================================================================
    // 5 · CAMINO INFELIZ: la Bandeja que nunca termina de cargar
    // =====================================================================
    await page.route("**/api/conversations", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"message":"boom"}}',
      })
    );
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    const errorBandeja = await page.waitForSelector("[data-testid='bandeja-error']", {
      timeout: 20000,
    });
    ok("027 · la Bandeja rota DICE que se rompió (antes: 'Cargando…' para siempre)", !!errorBandeja);
    ok("027 · ... y ofrece reintentar",
      (await page.locator("[data-testid='bandeja-error'] button", { hasText: "Reintentar" }).count()) === 1);
    ok("027 · ... y no se hace pasar por una bandeja vacía",
      ((await page.locator("[data-testid='bandeja-error']").textContent()) ?? "").includes("no se han perdido"));

    // Se recupera: se quita el fallo y la lista vuelve.
    await page.unroute("**/api/conversations");
    await page.locator("[data-testid='bandeja-error'] button", { hasText: "Reintentar" }).click();
    const recuperada = await page.waitForSelector("[data-testid='conversation-item']", {
      timeout: 20000,
    });
    ok("027 · reintentar recupera la lista", !!recuperada);

    // =====================================================================
    // 6 · CAMINO INFELIZ: el Pipeline que MIENTE sobre el negocio
    // =====================================================================
    await page.route("**/api/pipeline/board", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"message":"boom"}}',
      })
    );
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    const errorPipeline = await page.waitForSelector("[data-testid='pipeline-error']", {
      timeout: 20000,
    });
    ok("027 · el Pipeline caído DICE que se cayó", !!errorPipeline);
    ok("027 · ... y NO afirma que no tengas etapas (era un hecho falso)",
      (await page.locator("text=todavía no tiene etapas").count()) === 0);
    await page.unroute("**/api/pipeline/board");
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    // La cabecera del Pipeline (y su botón "Gestionar etapas") existe siempre: es
    // la señal de que la pantalla volvió a pintar de verdad y no del error.
    const cabecera = await page.waitForSelector("button:has-text('Gestionar etapas')", {
      timeout: 20000,
    });
    ok("027 · el Pipeline vuelve a pintar la pantalla al reintentar", !!cabecera);
    ok("027 · ... y el aviso de error desaparece",
      (await page.locator("[data-testid='pipeline-error']").count()) === 0);

    // =====================================================================
    // 7 · La Agenda vacía explica qué es y qué hacer
    // =====================================================================
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='agenda-group-overdue']", { timeout: 30000 });
    const vacia = await page.locator("[data-testid='agenda-empty']").textContent();
    ok("027 · la Agenda vacía no es un hueco: lo dice",
      (await page.locator("[data-testid='agenda-empty']").count()) === 1, `vacia=${vacia}`);
    ok("027 · ... explica QUÉ es y QUÉ hacer",
      (vacia ?? "").includes("No hay recordatorios") && (vacia ?? "").includes("Recordarme"),
      vacia);
    ok("027 · ... y los cinco grupos siguen explicando la estructura (013 C3)",
      (await page.locator("[data-testid^='agenda-group-']").count()) === 5);

    // =====================================================================
    // 8 · MÓVIL (375 px): el cajón de navegación
    // =====================================================================
    const movil = await browser.newContext({
      viewport: { width: 375, height: 720 },
      storageState: await context.storageState(),
    });
    const pMovil = await movil.newPage();
    await pMovil.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await pMovil.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });

    const navAbierto = pMovil.locator("[data-testid='nav-abrir']");
    const cajon = pMovil.locator("[data-testid='nav-cajon']");
    const enPantalla = async (locator) => {
      const caja = await locator.boundingBox();
      if (!caja) return false;
      return caja.x >= -1 && caja.x + caja.width > 1;
    };
    ok("027 · en móvil el nav se puede abrir", await navAbierto.isVisible());
    ok("027 · en móvil el nav arranca CERRADO (no se come los 375 px)",
      !(await enPantalla(cajon)));
    ok("027 · ... y declara que está cerrado",
      (await navAbierto.getAttribute("aria-expanded")) === "false");

    await navAbierto.click();
    await pMovil.waitForTimeout(400);
    ok("027 · al abrirlo entra en pantalla", await enPantalla(cajon));
    ok("027 · ... y declara que está abierto",
      (await navAbierto.getAttribute("aria-expanded")) === "true");
    ok("027 · ... y hay un velo que lo cierra al tocar fuera",
      await pMovil.locator("[data-testid='nav-velo']").isVisible());
    const anchoCajon = (await cajon.boundingBox())?.width ?? 0;
    ok("027 · el cajón es usable: deja sitio al contenido", anchoCajon <= 260, `${anchoCajon}px`);

    // Escape cierra y devuelve el foco: sin puntero, sin salida.
    await pMovil.keyboard.press("Escape");
    await pMovil.waitForTimeout(400);
    ok("027 · Escape cierra el cajón", !(await enPantalla(cajon)));
    const focoTrasEscape = await pMovil.evaluate(
      () => document.activeElement?.getAttribute("data-testid")
    );
    ok("027 · ... y devuelve el foco al botón que lo abrió",
      focoTrasEscape === "nav-abrir", `foco=${focoTrasEscape}`);

    // Navegar también lo cierra: si no, parece un bug.
    await navAbierto.click();
    await pMovil.waitForTimeout(400);
    await pMovil.locator("[data-testid='nav-cajon'] nav a", { hasText: "Agenda" }).first().click();
    await pMovil.waitForTimeout(600);
    ok("027 · navegar también cierra el cajón",
      new URL(pMovil.url()).pathname === "/agenda" && !(await enPantalla(cajon)),
      `${pMovil.url()} cajon=${await enPantalla(cajon)}`);

    // =====================================================================
    // 9 · MÓVIL: la Bandeja va lista → hilo → detalles, y vuelve
    // =====================================================================
    await pMovil.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await pMovil.waitForSelector("[data-testid='conversation-item']", { timeout: 30000 });
    const listaMovil = pMovil.locator("[data-testid='bandeja-lista']");
    const hiloMovil = pMovil.locator("[data-testid='bandeja-hilo']");
    const anchoLista = (await listaMovil.boundingBox())?.width ?? 0;
    ok("027 · en móvil la lista ocupa la pantalla entera",
      (await listaMovil.isVisible()) && (await hiloMovil.isHidden()) && anchoLista > 300,
      `lista=${anchoLista}`);

    // La conversación ya no es "del humano" (este corte reactivó su IA antes), así
    // que el hilo se ancla en su cabecera y en el botón de detalles, no en el
    // bloque de atención.
    const abrirHilo = async () => {
      await pMovil.locator("[data-testid='conversation-item']").first().click();
      await pMovil.waitForSelector("[data-testid='hilo-volver']", { timeout: 30000 });
    };
    await abrirHilo();
    ok("027 · al abrir una conversación, el hilo sustituye a la lista",
      (await listaMovil.isHidden()) && (await hiloMovil.isVisible()));

    const volver = pMovil.locator("[data-testid='hilo-volver']");
    ok("027 · el hilo ofrece un 'atrás' (que en escritorio no tiene sentido)",
      await volver.isVisible());
    ok("027 · el 'atrás' se anuncia por nombre, no solo con un icono",
      (await volver.getAttribute("aria-label")) === "Volver a la lista de conversaciones");
    await volver.click();
    await pMovil.waitForTimeout(400);
    ok("027 · 'atrás' devuelve a la lista", await listaMovil.isVisible());

    // Y en escritorio el mismo 'atrás' NO aparece: no hay a dónde volver.
    ok("027 · en escritorio el 'atrás' del hilo no aparece",
      !(await page.locator("[data-testid='hilo-volver']").isVisible()));

    // Los detalles a pantalla completa, no 320 px sobre 375.
    await abrirHilo();
    await pMovil.locator("[aria-label='Mostrar detalles']").click();
    await pMovil.waitForTimeout(400);
    const panelMovil = pMovil.locator("[data-testid='bandeja-detalles']");
    const anchoPanel = (await panelMovil.boundingBox())?.width ?? 0;
    ok("027 · en móvil el panel de detalles ocupa la pantalla, no 320 px",
      (await panelMovil.isVisible()) && anchoPanel > 300, `${anchoPanel}px`);
    // Y se vuelve al hilo desde el panel, sin quedarse atrapado.
    await pMovil.locator("[aria-label='Ocultar panel']").click();
    await pMovil.waitForTimeout(400);
    ok("027 · cerrar los detalles devuelve al hilo (no deja atrapado)",
      (await hiloMovil.isVisible()) && (await panelMovil.isHidden()));
    await movil.close();

    // =====================================================================
    // 10 · Las garantías del bloque, otra vez
    // =====================================================================
    ok("027 · CERO seguimientos automáticos: sales_follow_up_job intacta",
      (await jobsDe()) === jobsInicial, `${jobsInicial} → ${await jobsDe()}`);
    ok("027 · el outbox NO creció: ni «Marcar atendido» ni «Recordarme» mandan WhatsApp",
      (await outboxDe()) === outboxInicial, `${outboxInicial} → ${await outboxDe()}`);
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
