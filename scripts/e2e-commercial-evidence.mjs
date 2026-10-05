/** 028 — spec 016: webhook real, proveedores mock, hilo/cola/UI; BD exclusiva. */
export async function runCommercialEvidenceSelftest({ BASE, api, ok, waitFor, getCookie }) {
  const local = value => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  const dbUrl = process.env.E2E_COMMERCIAL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl || !local(BASE) || !local(dbUrl) || !/^(commercial_resources_test|vocero_e2e)(_|$)/.test(new URL(dbUrl).pathname.slice(1)) || process.env.WA_MOCK_ENABLED !== "true" || process.env.NODE_ENV === "production") throw new Error("028 requiere app/BD local dedicada y mocks");
  for (const key of ["META_GRAPH_BASE_URL", "TYPESAFE_JEV_ENDPOINT", "OPENROUTER_BASE_URL"]) if (!process.env[key] || !local(process.env[key]) || new URL(process.env[key]).port !== "3033") throw new Error(`028 ${key} requiere mock :3033`);
  if (!(await fetch(`${BASE}/api/health`)).ok) throw new Error("028 app no saludable");
  const { default: http } = await import("node:http");
  const { default: postgres } = await import("postgres");
  const { chromium } = await import("playwright");
  let reply = { commercial_evidence: "supported", text: "S/247 al mes hasta 50 alumnos activos; implementación asistida incluida." };
  let action = "present_price", unavailable = false, lastJev, lastWriter, writerCalls = 0;
  const provider = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks); res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/graph/")) {
      const upstream = await fetch(`${BASE}/api/dev/wa-mock${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? "", "content-type": req.headers["content-type"] ?? "application/json" }, ...(req.method === "POST" ? { body } : {}) });
      res.statusCode = upstream.status; res.end(await upstream.text()); return;
    }
    if (req.url === "/jev") {
      lastJev = JSON.parse(body);
      res.end(JSON.stringify({ model: "evidence-fixture", answers: { next_action: { type: "choice", choice: action }, needs_human_call: { type: "noul", noul: 0.1 } } })); return;
    }
    writerCalls++; lastWriter = JSON.parse(body);
    if (unavailable) { res.statusCode = 503; res.end("{}"); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
  });
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(3033, "127.0.0.1", resolve); });
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  let browser, previousOrg;
  try {
    let login = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123" }) });
    if (!login.res.ok) login = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" }) });
    if (!login.res.ok) throw new Error("028 login falló");
    previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
    const created = await api("/api/auth/organization/create", { method: "POST", body: JSON.stringify({ name: "Evidencia comercial E2E", slug: `evidence-${Date.now()}` }) });
    const org = created.json?.id; if (!org) throw new Error("028 org ausente");
    await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: org }) });
    const pn = `PN-EVIDENCE-${Date.now()}`;
    await sql`INSERT INTO agent_profile (id, organization_id, name, enabled, sales_orchestrator_enabled, sales_follow_ups_enabled) VALUES (${`agp_${pn}`}, ${org}, 'E2E', true, true, false)`;
    await sql`INSERT INTO pipeline_stage (id, organization_id, name, kind, position) VALUES (${`stg_${pn}`}, ${org}, 'En conversación', 'open', 0)`;
    ok("028 · conexión mock", (await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ phoneNumberId: pn, wabaId: "fixture", token: "fixture-local" }) })).res.ok);
    await api("/api/dev/playbook-bootstrap", { method: "POST" });
    // Reproducir Published vieja que omitía asistencia; runtime debe protegerla.
    await sql`UPDATE sales_playbook_version SET product_json=jsonb_set(product_json, '{core_jobs}', '["Alumnos", "Pagos parciales y saldos", "Matrícula online"]'::jsonb) WHERE organization_id=${org}`;
    let sequence = 0;
    const send = async (label, text, phone, silent = false) => {
      phone ??= `51998${String(Date.now()).slice(-5)}${String(++sequence).padStart(2, "0")}`;
      const before = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      const previous = await sql`SELECT m.id FROM message m JOIN contact ct ON ct.id=(SELECT contact_id FROM conversation WHERE id=m.conversation_id) WHERE m.organization_id=${org} AND ct.name=${label} AND m.direction='out'`;
      const old = new Set(previous.map(m => m.id));
      ok(`028 · inbound ${label}`, (await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: pn, from: phone, name: label, text, waMessageId: `wamid.evidence.${Date.now()}.${++sequence}` }) })).res.ok);
      const done = await waitFor(async () => {
        const rows = await sql`SELECT c.id, c.handoff_at, c.handoff_reason, l.automation_lane, l.last_jev_decision, ct.id AS contact_id FROM conversation c JOIN contact ct ON ct.id=c.contact_id JOIN lead l ON l.contact_id=ct.id AND l.organization_id=c.organization_id WHERE c.organization_id=${org} AND ct.name=${label}`;
        if (!rows[0]) return null;
        const messages = await sql`SELECT * FROM message WHERE organization_id=${org} AND conversation_id=${rows[0].id} AND direction='out' ORDER BY created_at`;
        const fresh = messages.filter(m => !old.has(m.id));
        return (silent ? rows[0].handoff_at : fresh.length && rows[0].last_jev_decision) ? { ...rows[0], messages: fresh } : null;
      }, 45000);
      if (!done) throw new Error(`028 turno pendiente ${label}`);
      const after = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      return { ...done, phone, outbox: after.filter(m => !before.some(b => b.n === m.n)) };
    };
    const r1 = await send("Roberto", "Precio");
    ok("028 · Roberto precio vigente", r1.messages[0]?.text.includes("S/247") && !r1.handoff_at);
    action = "ask_more_questions";
    reply = { commercial_evidence: "supported", text: "Incluye alumnos, matrículas, pagos y saldos, con implementación asistida." };
    const r2 = await send("Roberto", "¿Qué incluye el servicio?", r1.phone);
    ok("028 · Roberto explicación sin handoff", r2.messages.length === 1 && !r2.handoff_at);
    reply = { commercial_evidence: "supported", text: "Sí, puedes registrar la asistencia de los alumnos y llevar el control de sus sesiones. ¿Hoy cómo la registran?" };
    const r3 = await send("Roberto", "Necesito un control de asistencia", r1.phone);
    ok("028 · Roberto respuesta afirmativa breve", r3.messages.length === 1 && r3.messages[0].text === reply.text && r3.outbox[0]?.body?.text?.body === reply.text && !r3.handoff_at);
    ok("028 · conocimiento asistencia llega a Jev y writer con Published antigua", JSON.stringify(lastJev.state.product).includes("registro de asistencia") && JSON.stringify(lastWriter.messages).includes("control/consumo de sesiones") && JSON.stringify(lastWriter.messages).includes("Búsqueda por DNI, nombre o apellido"));
    ok("028 · Jev política reforzada", lastJev.questions.next_action.instructions.includes("HANDOFF HUMANO SILENCIOSO"));
    reply = { commercial_evidence: "unknown", text: "No tengo confirmado, creo que sí" };
    const unknown = await send("Unknown integración", "¿Se integra directamente con SistemaNoDocumentado?", undefined, true);
    ok("028 · unknown silencio absoluto", unknown.messages.length === 0 && unknown.outbox.length === 0);
    ok("028 · unknown HUMAN efectivo y propuesta auditada", unknown.automation_lane === "human" && unknown.handoff_reason === "commercial" && unknown.last_jev_decision.plan.nextAction === "schedule_call" && unknown.last_jev_decision.plan.commercialEvidenceReason === "unknown" && unknown.last_jev_decision.decision.nextAction.choice === "ask_more_questions");
    const panel = await api(`/api/contacts/${unknown.contact_id}`);
    ok("028 · API panel muestra HUMAN efectivo", panel.json?.lead?.sales?.snapshot?.nextAction === "schedule_call");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(getCookie().split("; ").filter(Boolean).map(entry => { const n = entry.indexOf("="); return { name: entry.slice(0, n), value: entry.slice(n + 1), url: BASE }; }));
    const page = await context.newPage(); await page.goto(`${BASE}/inbox`);
    const row = page.locator("[data-testid='conversation-item']", { hasText: "Unknown integración" });
    await row.waitFor({ timeout: 30000 });
    ok("028 · UI Por atender", (await row.textContent()).includes("Por atender"));
    await row.click(); await page.locator("[data-testid='attention-state']").waitFor();
    ok("028 · panel Atención humana / Por atender", (await page.locator("[data-testid='attention-state']").textContent()).includes("Por atender") && await page.getByText("Atención humana", { exact: true }).isVisible());
    const beforeCalls = writerCalls;
    await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: pn, from: unknown.phone, text: "¿Me confirmas?", waMessageId: `wamid.paused.${Date.now()}` }) });
    // Inbound procesado y la coalescencia ya pasó antes de verificar silencio.
    await new Promise(resolve => setTimeout(resolve, 2500));
    ok("028 · IA permanece pausada", writerCalls === beforeCalls && (await sql`SELECT id FROM message WHERE organization_id=${org} AND conversation_id=${unknown.id} AND direction='out'`).length === 0);
    for (const [label, text, answer] of [["Known marcación", "¿Cómo marco asistencia por DNI o nombre?", "En Control de Acceso puedes buscar por DNI, nombre o apellido y confirmar el registro de asistencia."], ["Known pagos", "¿Puedo registrar pagos parciales y saldos?", "Sí, puedes registrar pagos parciales y llevar los saldos pendientes."], ["Known matrícula", "¿Tiene matrícula online?", "Sí, la matrícula online es opcional."]]) {
      reply = { commercial_evidence: "supported", text: answer };
      const known = await send(label, text);
      ok(`028 · ${label} responde`, !known.handoff_at && known.messages[0]?.text === answer);
    }
    await sql`INSERT INTO kb_entry (id, organization_id, kind, question, answer) VALUES (${`kb_${pn}`}, ${org}, 'qa', '¿Se integra con SistemaDocumentado?', 'Sí, integración documentada por importación CSV.')`;
    reply = { commercial_evidence: "supported", text: "Sí, mediante importación CSV." };
    const documented = await send("Known KB", "¿Se integra con SistemaDocumentado?");
    ok("028 · KB scoped disponible a ambos proveedores", !documented.handoff_at && JSON.stringify(lastJev.state.commercial_knowledge).includes("SistemaDocumentado") && JSON.stringify(lastWriter.messages).includes("SistemaDocumentado"));
    reply = { commercial_evidence: "context_needed", text: "¿Qué te cuesta más controlar hoy en tu academia?" };
    const needs = await send("Falta contexto", "Necesito algo para controlar mejor mi academia");
    ok("028 · falta contexto pregunta, no handoff", needs.messages[0]?.text === reply.text && !needs.handoff_at && needs.last_jev_decision.plan.nextAction === "ask_more_questions");
    reply = { text: "Sí, se integra" };
    const malformed = await send("Sin clasificación", "¿Tiene API para X?", undefined, true);
    ok("028 · sin clasificación falla cerrado", malformed.messages.length === 0 && malformed.outbox.length === 0 && malformed.handoff_reason === "commercial");
    unavailable = true;
    const failure = await send("Fallo writer", "¿Soporta una modalidad especial?", undefined, true);
    ok("028 · fallo proveedor atención humana sin outbound", failure.messages.length === 0 && failure.outbox.length === 0 && failure.last_jev_decision.plan.commercialEvidenceReason === "writer_unavailable");
    unavailable = false; reply = { commercial_evidence: "unknown", text: null };
    const beforeSandbox = (await api("/api/dev/wa-mock/outbox")).json;
    const preview = await api("/api/lab/preview", { method: "POST", body: JSON.stringify({ mode: "published", conversation: [{ from: "lead", text: "¿Se integra con SistemaNoDocumentado?" }] }) });
    ok("028 · sandbox unknown silencioso", preview.res.ok && preview.json?.plan?.lane === "human" && preview.json?.writer?.text === null);
    ok("028 · sandbox cero Graph", JSON.stringify((await api("/api/dev/wa-mock/outbox")).json) === JSON.stringify(beforeSandbox));
  } finally {
    await browser?.close();
    if (previousOrg) await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: previousOrg }) });
    await sql.end(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  }
}
