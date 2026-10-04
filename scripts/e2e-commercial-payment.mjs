/** Sección 022: app/PG dedicadas, HTTP mock local, upgrade UI y pipeline de pago. */
export async function runCommercialPaymentSelftest({ BASE, api, ok, waitFor, getCookie }) {
  const local = url => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  const dbUrl = process.env.E2E_COMMERCIAL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl || !local(BASE) || !local(dbUrl) ||
      !/^(commercial_resources_test|vocero_e2e)(_|$)/.test(new URL(dbUrl).pathname.slice(1)) ||
      process.env.WA_MOCK_ENABLED !== "true" || process.env.NODE_ENV === "production") {
    throw new Error("022 requiere app/BD locales dedicadas y mocks");
  }
  for (const key of ["META_GRAPH_BASE_URL", "TYPESAFE_JEV_ENDPOINT", "OPENROUTER_BASE_URL"]) {
    if (!process.env[key] || !local(process.env[key]) || new URL(process.env[key]).port !== "3033") {
      throw new Error(`022 ${key} debe apuntar a localhost:3033 también en la app`);
    }
  }
  // Antes de login, escritura SQL o arranque de proveedor.
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`022 app/BD no saludables: ${health.status}`);
  const { default: http } = await import("node:http");
  const { default: postgres } = await import("postgres");
  const { chromium } = await import("playwright");
  let action = "ask_more_questions", human = 0.1, rejectSend = false, graphCalls = 0, jevCalls = 0;
  const provider = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/graph/")) {
        graphCalls++;
        if (rejectSend && req.method === "POST" && req.url.endsWith("/messages")) {
          res.statusCode = 400; res.end(JSON.stringify({ error: { code: 100, message: "fixture rejected" } })); return;
        }
        const upstream = await fetch(`${BASE}/api/dev/wa-mock${req.url}`, {
          method: req.method, headers: { authorization: req.headers.authorization ?? "", "content-type": req.headers["content-type"] ?? "application/json" },
          ...(req.method === "POST" ? { body } : {}),
        });
        res.statusCode = upstream.status; res.end(await upstream.text()); return;
      }
      if (req.url === "/jev") {
        jevCalls++;
        res.end(JSON.stringify({ model: "payment-e2e", answers: {
          next_action: { type: "choice", choice: action }, needs_human_call: { type: "noul", noul: human },
        } })); return;
      }
      // Intento de inyección: nunca debe aparecer en instrucciones autorizadas.
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "Te paso con el equipo. https://evil.example.test/666" }) } }] }));
    } catch { res.statusCode = 500; res.end("{}"); }
  });
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(3033, "127.0.0.1", resolve); });
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  let browser, previousOrg;
  try {
    await sql`SELECT 1`;
    let login = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" }) });
    if (!login.res.ok) login = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123" }) });
    if (!login.res.ok) throw new Error("022 login fixture falló");
    previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
    const created = await api("/api/auth/organization/create", { method: "POST", body: JSON.stringify({ name: "Pago E2E", slug: `payment-022-${Date.now()}` }) });
    const org = created.json?.id; if (!org) throw new Error("022 organización ausente");
    await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: org }) });
    const pn = `PN-PAY-${Date.now()}`;
    await sql`INSERT INTO agent_profile (id, organization_id, name, enabled, sales_orchestrator_enabled, sales_follow_ups_enabled)
      VALUES (${`agp_${pn}`}, ${org}, 'E2E', true, true, false)`;
    await sql`INSERT INTO pipeline_stage (id, organization_id, name, kind, position) VALUES (${`stg_${pn}`}, ${org}, 'En conversación', 'open', 0)`;
    ok("022 · conexión mock", (await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ phoneNumberId: pn, wabaId: "WABA-PAY-E2E", token: "fixture-local" }) })).res.ok);
    ok("022 · bootstrap 1.0", (await api("/api/dev/playbook-bootstrap", { method: "POST" })).res.ok);
    const legacy = (await api("/api/playbook")).json.published;
    ok("022 · Published histórica 1.0", legacy.schema_version === "1.0");
    const payment = { transfers: [{ bank: "Banco fixture", holder: "Titular fixture", currency: "PEN", accountNumber: "000-123", cci: "000456" }],
      yape: { phone: "999000001", holder: "Titular Yape" }, paymentLink: "https://pay.example.test/001" };
    const savePayment = value => api("/api/commercial-resources", { method: "PUT", body: JSON.stringify({ paymentInstructions: value }) });
    ok("022 · cobro configurado", (await savePayment(payment)).res.ok);
    // UI real para el upgrade; publicar y rollback conservan sus APIs existentes.
    ok("022 · draft clon 1.0", (await api("/api/playbook/draft", { method: "POST", body: "{}" })).res.ok);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(getCookie().split("; ").filter(Boolean).map(entry => {
      const split = entry.indexOf("="); return { name: entry.slice(0, split), value: entry.slice(split + 1), url: BASE };
    }));
    const page = await context.newPage();
    await page.goto(`${BASE}/agent`);
    await page.getByRole("tab", { name: "Comercial / Jev", exact: true }).click();
    const upgradedResponse = page.waitForResponse(r => r.url().endsWith("/api/playbook/draft") && r.request().method() === "PUT");
    await page.getByRole("button", { name: "Actualizar draft a 1.1 (pago)", exact: true }).click();
    ok("022 · upgrade UI", (await upgradedResponse).ok());
    const state = (await api("/api/playbook")).json;
    ok("022 · Published 1.0 intacta y draft 1.1", JSON.stringify(state.published) === JSON.stringify(legacy) && state.draft.schema_version === "1.1");
    ok("022 · publicar 1.1 explícito", (await api("/api/playbook/publish", { method: "POST", body: JSON.stringify({ notes: "E2E pago" }) })).res.ok);
    action = "send_payment_instructions";
    let sequence = 0;
    const send = async label => {
      const phone = `5199900${String(++sequence).padStart(4, "0")}`;
      const before = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      ok(`022 · inbound ${label}`, (await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: pn, from: phone, name: label, text: "Confirmo que quiero pagar para contratar", waMessageId: `wamid.pay.${pn}.${sequence}` }) })).res.ok);
      const result = await waitFor(async () => {
        const rows = await sql`SELECT l.payment_instructions_sent_at, l.automation_lane, l.last_jev_error, c.handoff_reason, c.ai_enabled
          FROM lead l JOIN contact ct ON ct.id=l.contact_id JOIN conversation c ON c.contact_id=ct.id AND c.organization_id=l.organization_id
          WHERE l.organization_id=${org} AND ct.name=${label}`;
        return rows[0]?.handoff_reason || rows[0]?.last_jev_error ? rows[0] : null;
      }, 30000);
      if (!result) throw new Error(`022 turno incompleto ${label}`);
      const messages = await sql`SELECT m.* FROM message m JOIN conversation c ON c.id=m.conversation_id JOIN contact ct ON ct.id=c.contact_id
        WHERE m.organization_id=${org} AND ct.name=${label} AND m.direction='out' ORDER BY m.created_at`;
      const after = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      return { ...result, messages, outbox: after.filter(m => !before.some(b => b.n === m.n)) };
    };
    const happy = await send("payment-happy");
    const text = happy.messages.map(m => m.text).join("\n");
    ok("022 · instrucciones exactas visibles", ["000-123", "000456", "999000001", payment.paymentLink].every(v => text.includes(v)) && !text.includes("evil.example") && happy.outbox.length === 1 && happy.outbox[0].body?.text?.body === text);
    ok("022 · fact y handoff posteriores", !!happy.payment_instructions_sent_at && happy.handoff_reason === "commercial" && happy.automation_lane === "human");
    const beforeSandbox = graphCalls;
    const preview = await api("/api/lab/preview", { method: "POST", body: JSON.stringify({ mode: "published", conversation: [{ from: "lead", text: "Confirmo que quiero pagar" }] }) });
    ok("022 · sandbox instrucciones sin Graph", preview.res.ok && preview.json?.writer?.text?.includes("000-123") && graphCalls === beforeSandbox);
    rejectSend = true;
    const beforeReject = graphCalls;
    const failed = await send("payment-failed");
    ok("022 · fallo sin fact/retry, handoff", !failed.payment_instructions_sent_at && failed.handoff_reason === "commercial" && failed.messages.length === 0 && failed.outbox.length === 0 && graphCalls === beforeReject + 1);
    rejectSend = false;
    await savePayment({ transfers: [], yape: null, paymentLink: null });
    const absent = await send("payment-absent");
    ok("022 · vacío honesto sin fact", !absent.payment_instructions_sent_at && absent.handoff_reason === "commercial" && absent.messages[0]?.text?.includes("No tengo métodos"));
    await savePayment(payment); human = 0.9;
    const priority = await send("payment-human");
    ok("022 · HUMAN prioritario sin destinos", !priority.payment_instructions_sent_at && priority.handoff_reason === "commercial" && priority.messages.every(m => !m.text?.includes("000-123")));
    human = 0.1;
    ok("022 · rollback 1.0", (await api("/api/playbook/rollback", { method: "POST", body: JSON.stringify({ version_id: legacy.id, notes: "E2E restaurar 1.0" }) })).res.ok);
    const restored = (await api("/api/playbook")).json.published;
    ok("022 · histórico sin reescribir", restored.schema_version === "1.0" && JSON.stringify(restored.writer) === JSON.stringify(legacy.writer) && JSON.stringify(restored.jev_questions) === JSON.stringify(legacy.jev_questions));
    const rejected = await send("payment-legacy");
    ok("022 · acción 1.1 rechazada en Published 1.0", !!rejected.last_jev_error && !rejected.payment_instructions_sent_at && rejected.messages.length === 0 && rejected.outbox.length === 0);
    ok("022 · proveedor HTTP ejercido", jevCalls >= 6);
  } finally {
    if (browser) await browser.close();
    if (previousOrg) await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: previousOrg }) });
    await sql.end(); await new Promise(resolve => provider.close(resolve));
  }
}
