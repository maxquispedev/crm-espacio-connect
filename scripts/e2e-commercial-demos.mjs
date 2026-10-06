/** Sección 021 del self-test: app/PG dedicadas + pipeline real + mocks HTTP.
 * App: Graph=http://127.0.0.1:3033/graph, Jev=:3033/jev, writer=:3033.
 * Solo fixtures locales. No binarios en Git ni WhatsApp real.
 */
export async function runCommercialDemoSelftest({ BASE, api, ok, waitFor }) {
  const local = url => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  const providerPort = Number(process.env.E2E_COMMERCIAL_PROVIDER_PORT ?? 3033);
  const dbUrl = process.env.E2E_COMMERCIAL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl || !local(BASE) || !local(dbUrl) || !/^(commercial_resources_test|vocero_e2e)(_|$)/.test(new URL(dbUrl).pathname.slice(1)) ||
      process.env.WA_MOCK_ENABLED !== "true" || process.env.NODE_ENV === "production") throw new Error("021 requiere app/BD locales dedicadas y mocks");
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`021 app/BD no saludables: ${health.status}`);
  for (const key of ["META_GRAPH_BASE_URL", "TYPESAFE_JEV_ENDPOINT", "OPENROUTER_BASE_URL"]) {
    const url = process.env[key];
    if (!url || !local(url) || Number(new URL(url).port) !== providerPort) throw new Error(`021 ${key} debe apuntar al proveedor mock localhost:3033 también en la app`);
  }
  const { default: http } = await import("node:http");
  const { default: postgres } = await import("postgres");
  const { readFile } = await import("node:fs/promises");
  const { generateCommercialVideo } = await import("./e2e-commercial-video.mjs");
  let failMedia = false;
  let action = "show_operations_demo";
  let providerCalls = 0;
  const provider = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/graph/")) {
        if (failMedia && /\/(media|messages)$/.test(req.url) && req.method === "POST") {
          res.statusCode = 400; res.end(JSON.stringify({ error: { message: "fixture media rejected", code: 100 } })); return;
        }
        const upstream = await fetch(`${BASE}/api/dev/wa-mock${req.url}`, { method: req.method,
          headers: { authorization: req.headers.authorization ?? "", "content-type": req.headers["content-type"] ?? "application/json" },
          ...(req.method === "POST" ? { body } : {}) });
        res.statusCode = upstream.status; res.end(await upstream.text()); return;
      }
      providerCalls++;
      if (req.url === "/jev") {
        res.end(JSON.stringify({ model: "demo-e2e", answers: { real_operational_need: { type: "noul", noul: 0.16 }, purchase_intent: { type: "score", score: 0.1 }, product_fit: { type: "score", score: 0.5 }, next_action: { type: "choice", choice: action }, needs_human_call: { type: "noul", noul: 0.1 } } })); return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ commercial_evidence: "supported", text: "Así funciona esta parte del sistema." }) } }] }));
    } catch { res.statusCode = 500; res.end("{}"); }
  });
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(providerPort, "127.0.0.1", resolve); });
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  let org;
  let previousOrg;
  try {
    await sql`SELECT 1`;
    const bytes = await readFile(await generateCommercialVideo());
    let login = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" }) });
    if (!login.res.ok) login = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123" }) });
    if (!login.res.ok) throw new Error("021 login fixture falló");
    previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
    const created = await api("/api/auth/organization/create", { method: "POST", body: JSON.stringify({ name: "Demos E2E", slug: `demos-021-${Date.now()}` }) });
    org = created.json?.id; if (!org) throw new Error("021 organización fixture ausente");
    await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: org }) });
    const pn = `PN-DEMO-${Date.now()}`;
    await sql`INSERT INTO agent_profile (id, organization_id, name, enabled, sales_orchestrator_enabled, sales_follow_ups_enabled)
      VALUES (${`agp_${pn}`}, ${org}, 'E2E', true, true, false)`;
    await sql`INSERT INTO pipeline_stage (id, organization_id, name, kind, position) VALUES (${`stg_${pn}`}, ${org}, 'En conversación', 'open', 0)`;
    ok("021 · conexión exclusivamente mock", (await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ phoneNumberId: pn, wabaId: "WABA-DEMO-E2E", token: "fixture-local" }) })).res.ok);
    await api("/api/dev/playbook-bootstrap", { method: "POST" });
    const slots = ["demo_enrollment_panel", "demo_payments_balances", "demo_online_enrollment"];
    for (const slot of slots) {
      const form = new FormData(); form.set("file", new File([bytes], `${slot}.mp4`, { type: "video/mp4" }));
      ok(`021 · upload local ${slot}`, (await api(`/api/commercial-resources/videos/${slot}`, { method: "PUT", body: form })).res.ok);
    }
    let phoneCounter = 0;
    const send = async (label, text, opts = {}) => {
      const phone = opts.phone ?? `51999${String(Date.now()).slice(-5)}${++phoneCounter}`;
      const oldMessages = await sql`SELECT id FROM message WHERE organization_id=${org} AND direction='out'`;
      const oldIds = new Set(oldMessages.map(m => m.id));
      const before = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      ok(`021 · inbound ${label}`, (await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: pn, from: phone, name: label, text, ...(opts.referral ? { referral: opts.referral } : {}), waMessageId: `wamid.demo.${label}.${Date.now()}` }) })).res.ok);
      const messages = await waitFor(async () => {
        const rows = await sql`SELECT m.*, a.caption, a.file_name FROM message m JOIN conversation c ON c.id=m.conversation_id
          JOIN contact ct ON ct.id=c.contact_id LEFT JOIN media_asset a ON a.id=m.media_asset_id AND a.organization_id=m.organization_id
          WHERE m.organization_id=${org} AND ct.name=${label} AND m.direction='out' ORDER BY m.created_at`;
        const fresh = rows.filter(m => !oldIds.has(m.id));
        return fresh.length && fresh.every(m => m.status === "failed" || m.wa_message_id) ? fresh : null;
      }, 30000);
      if (!messages) throw new Error(`021 sin outbound ${label}`);
      // Explicit provider status confirms effects; Graph wamid alone is pending.
      for (const message of messages.filter(m => m.wa_message_id && m.status !== "failed")) {
        const status = await api("/api/dev/wa-mock/status", { method: "POST", body: JSON.stringify({ waMessageId: message.wa_message_id, status: "sent" }) });
        if (!status.res.ok) throw new Error("021 successful status rejected");
      }
      const readFact = async () => (await sql`SELECT l.demo_shown_at FROM lead l JOIN contact c ON c.id=l.contact_id WHERE l.organization_id=${org} AND c.name=${label}`)[0]?.demo_shown_at;
      const fact = messages[0]?.type === "video" && messages[0]?.status !== "failed" ? await waitFor(readFact) : await readFact();
      const after = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      const lead = (await sql`SELECT l.last_jev_decision, c.id AS contact_id FROM lead l JOIN contact c ON c.id=l.contact_id WHERE l.organization_id=${org} AND c.name=${label}`)[0];
      const panel = await api(`/api/contacts/${lead.contact_id}`);
      return { messages, fact, phone, panel: panel.json, decision: lead?.last_jev_decision, outbox: after.filter(m => !before.some(b => b.n === m.n)) };
    };
    for (const [index, text] of ["muéstrame matrícula y alumnos", "muéstrame pagos y saldos", "matrícula online"].entries()) {
      action = index === 2 ? "show_online_enrollment_demo" : "show_operations_demo";
      const r = await send(`happy${index}`, text);
      ok(`021 · video nativo+caption en outbox ${index}`, r.outbox.length === 1 && r.outbox[0].type === "video" && !!r.outbox[0].body?.video?.caption);
      ok(`021 · hilo IA media+caption ${index}`, r.messages.length === 1 && r.messages[0].type === "video" && r.messages[0].text === null && !!r.messages[0].caption && r.messages[0].file_name === `${slots[index]}.mp4` && r.messages[0].origin === "ai" && r.messages[0].ai_generated);
      ok(`021 · fact tras webhook exitoso/persistencia ${index}`, !!r.fact);
    }
    // 015: Jev mock reproduce el fallo proponiendo demo incluso con curiosidad.
    const referral = { source_type: "ad", source_id: "fixture-payments", headline: "Controla pagos y saldos pendientes", body: "Organiza pagos y saldos" };
    for (const proposed of ["show_operations_demo", "show_online_enrollment_demo"]) {
      action = proposed;
      const r = await send(`opener-${proposed}`, "¡Hola! Quiero más información", { referral });
      const text = r.messages[0]?.text ?? "";
      ok(`015 A · ${proposed} texto sin video con UNA pregunta`, r.messages.length === 1 && r.messages[0].type === "text" && text.includes("pagos, saldos") && (text.match(/\?/g) ?? []).length === 1 && text.length < 250 && r.outbox.length === 1 && r.outbox[0].type === "text" && !r.fact);
      ok(`015 A · acción efectiva y propuesta auditables ${proposed}`, r.decision?.plan?.nextAction === "ask_more_questions" && r.decision?.decision?.nextAction?.choice === proposed && r.decision?.plan?.demoGuardReason === "generic_curiosity_only");
      ok(`015 A · panel muestra acción efectiva ${proposed}`, r.panel?.lead?.sales?.snapshot?.nextAction === "ask_more_questions");
      action = "show_operations_demo";
      const c = await send(`opener-${proposed}`, "Lo llevo en Excel y a veces se me pierden los Yapes / no sé quién debe", { phone: r.phone });
      ok(`015 C · segundo turno video pagos/saldos ${proposed}`, c.messages.length === 1 && c.messages[0].type === "video" && c.messages[0].file_name === "demo_payments_balances.mp4" && c.outbox[0]?.type === "video" && !!c.fact && c.decision?.plan?.nextAction === "show_operations_demo");
    }
    action = "show_operations_demo";
    const b = await send("explicit-payments", "Quiero ver cómo controlan los pagos y saldos pendientes", { referral });
    ok("015 B · demo explícito pagos/saldos", b.messages[0]?.file_name === "demo_payments_balances.mp4" && b.outbox[0]?.type === "video");
    const d0 = await send("change-topic", "¡Hola! Quiero más información", { referral });
    const d = await send("change-topic", "En realidad quiero ver cómo funciona la matrícula", { phone: d0.phone });
    ok("015 D · matrícula explícita gana al anuncio", d.messages[0]?.file_name === "demo_enrollment_panel.mp4" && d.outbox[0]?.type === "video");
    const genericDemo = await send("generic-demo", "Enséñame el sistema", { referral });
    ok("015 · pedido explícito genérico usa anuncio", genericDemo.messages[0]?.file_name === "demo_payments_balances.mp4");
    const e = await send("organic-opener", "Hola, quiero información");
    ok("015 E · orgánico pregunta sin demo", e.messages[0]?.type === "text" && (e.messages[0].text.match(/\?/g) ?? []).length === 1 && e.outbox[0]?.type === "text" && !e.fact && e.decision?.plan?.nextAction === "ask_more_questions");
    action = "show_operations_demo"; failMedia = true;
    const failed = await send("rejected", "muéstrame pagos");
    ok("021 · rechazo media visible, sin fact ni segundo envío", failed.messages.length === 1 && failed.messages[0].status === "failed" && failed.messages[0].origin === "ai" && !failed.fact && failed.outbox.length === 0);
    failMedia = false;
    await sql`DELETE FROM commercial_resource WHERE organization_id=${org} AND slot='demo_payments_balances'`;
    const absent = await send("absent", "muéstrame pagos");
    ok("021 · ausente responde honesto sin fact", absent.messages.length === 1 && absent.messages[0].type === "text" && absent.messages[0].text.includes("no está disponible") && !absent.fact && absent.outbox.length === 1);
    const outboxBefore = (await api("/api/dev/wa-mock/outbox")).json;
    action = "show_online_enrollment_demo";
    const preview = await api("/api/lab/preview", { method: "POST", body: JSON.stringify({ mode: "published", conversation: [{ from: "lead", text: "matrícula online" }] }) });
    ok("021 · preview conserva caption del media simulado", preview.res.ok && preview.json?.writer?.text === "Así funciona esta parte del sistema.");
    ok("021 · sandbox cero Graph", JSON.stringify((await api("/api/dev/wa-mock/outbox")).json) === JSON.stringify(outboxBefore));
    ok("021 · provider mock realmente ejercido", providerCalls >= 12);
  } finally {
    if (previousOrg) await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: previousOrg }) });
    await sql.end(); await new Promise(resolve => provider.close(resolve));
  }
}
