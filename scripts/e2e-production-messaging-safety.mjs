/** 029 / spec017: real webhook + PostgreSQL, deterministic local providers.
 * Graph acknowledgement and status are deliberately separate. No real recipients.
 */
export async function runProductionMessagingSafetySelftest({ BASE, api, ok, waitFor, getCookie }) {
  const local = value => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  const dbUrl = process.env.E2E_COMMERCIAL_DATABASE_URL ?? process.env.DATABASE_URL;
  const port = Number(process.env.E2E_SAFETY_PROVIDER_PORT ?? 3043);
  if (!dbUrl || !local(BASE) || !local(dbUrl) || new URL(dbUrl).pathname !== "/commercial_resources_test_safety" || process.env.WA_MOCK_ENABLED !== "true" || process.env.NODE_ENV === "production") throw new Error("029 requires local app, exclusive commercial_resources_test_safety database and mocks");
  for (const key of ["META_GRAPH_BASE_URL", "TYPESAFE_JEV_ENDPOINT", "OPENROUTER_BASE_URL"]) if (!process.env[key] || !local(process.env[key]) || Number(new URL(process.env[key]).port) !== port) throw new Error(`029 ${key} must target local provider :${port}`);
  const { default: http } = await import("node:http");
  const { default: postgres } = await import("postgres");
  const { readFile } = await import("node:fs/promises");
  const { createHmac } = await import("node:crypto");
  const { generateCommercialVideo } = await import("./e2e-commercial-video.mjs");
  const sql = postgres(dbUrl, { max: 4, onnotice: () => {} });
  const outbox = [];
  let action = "ask_more_questions", jevCalls = 0, writerCalls = 0;
  let suspendNext = false, suspendWriterNext = false, legacy = false, releaseProvider, suspended = false, earlyStatus = false;
  let pn, org, previousOrg, browser, counter = 0;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const statusRaw = async (wamid, state, number = pn) => {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA-SAFETY", changes: [{ field: "messages", value: { metadata: { phone_number_id: number }, statuses: [{ id: wamid, status: state, timestamp: String(Math.floor(Date.now() / 1000)), ...(state === "failed" ? { errors: [{ code: 131026, title: "Message undeliverable", message: "fixture undeliverable" }] } : {}) }] } }] }] });
    const headers = { "content-type": "application/json" };
    if (process.env.META_APP_SECRET) headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", process.env.META_APP_SECRET).update(raw).digest("hex")}`;
    const res = await fetch(`${BASE}/api/webhooks/wa/${process.env.META_WEBHOOK_VERIFY_TOKEN}`, { method: "POST", headers, body: raw });
    if (!res.ok) throw new Error(`029 status ${state} HTTP ${res.status}`);
    // Public webhook acknowledges before after() applies the receipt/effects.
    if (!await waitFor(async () => {
      const receipt = await sql`SELECT id FROM wa_status_receipt WHERE wa_message_id=${wamid} AND status=${state}`;
      if (!receipt.length) return false;
      const [message] = await sql`SELECT status FROM message WHERE wa_message_id=${wamid}`;
      if (!message) return true; // deliberately early receipt before Graph response
      const rank = { pending: 0, sent: 1, delivered: 2, read: 3 };
      return state === "failed" ? message.status === "failed" : message.status === "failed" || rank[message.status] >= rank[state];
    })) throw Error(`029 status ${state} not applied`);
  };
  const provider = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks); res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/graph/")) {
        if (req.method === "POST" && req.url.endsWith("/messages")) {
          const body = JSON.parse(raw);
          if (body.status === "read") { res.end('{"success":true}'); return; }
          const wamid = `wamid.safety.out.${Date.now()}.${++counter}`;
          outbox.push({ wamid, body });
          if (earlyStatus) await statusRaw(wamid, "delivered");
          res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: wamid }] })); return;
        }
        if (req.method === "POST" && req.url.endsWith("/media")) { res.end(JSON.stringify({ id: `fixture-upload-${++counter}` })); return; }
        const upstream = await fetch(`${BASE}/api/dev/wa-mock${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? "", "content-type": req.headers["content-type"] ?? "application/json" }, ...(req.method === "POST" ? { body: raw } : {}) });
        res.statusCode = upstream.status; res.end(await upstream.text()); return;
      }
      const body = JSON.parse(raw);
      if (req.url === "/jev") {
        jevCalls++;
        if (suspendNext) { suspendNext = false; suspended = true; await new Promise(resolve => { releaseProvider = resolve; }); suspended = false; }
        res.end(JSON.stringify({ model: "safety-fixture", answers: { next_action: { type: "choice", choice: action }, needs_human_call: { type: "noul", noul: 0.1 } } })); return;
      }
      writerCalls++;
      if (suspendWriterNext) { suspendWriterNext = false; suspended = true; await new Promise(resolve => { releaseProvider = resolve; }); suspended = false; }
      const text = action === "present_price" ? "S/247 al mes hasta 50 alumnos activos." : JSON.stringify(body.messages).includes("LATEST-SAFETY") ? "Respuesta LATEST-SAFETY." : "Así funciona esta parte del sistema.";
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(legacy ? { action: "reply", text } : { commercial_evidence: "supported", text }) } }] }));
    } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: String(err) })); }
  });
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(port, "127.0.0.1", resolve); });
  try {
    let login = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123" }) });
    if (!login.res.ok) login = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email: "e2e@vocero.test", password: "password-e2e-123", name: "Safety E2E" }) });
    if (!login.res.ok) throw new Error("029 login failed");
    previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
    const created = await api("/api/auth/organization/create", { method: "POST", body: JSON.stringify({ name: "Safety E2E", slug: `safety-${Date.now()}` }) });
    org = created.json?.id; if (!org) throw new Error("029 fixture org missing");
    await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: org }) });
    pn = `PN-SAFETY-${Date.now()}`;
    await sql`INSERT INTO agent_profile (id, organization_id, name, enabled, sales_orchestrator_enabled, sales_follow_ups_enabled) VALUES (${`agp_${pn}`}, ${org}, 'Safety', true, true, true)`;
    await sql`INSERT INTO pipeline_stage (id, organization_id, name, kind, position) VALUES (${`stg_${pn}`}, ${org}, 'En conversación', 'open', 0)`;
    ok("029 connection mock", (await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ phoneNumberId: pn, wabaId: "WABA-SAFETY", token: "fixture-local" }) })).res.ok);
    await api("/api/dev/playbook-bootstrap", { method: "POST" });
    const bytes = await readFile(await generateCommercialVideo());
    for (const slot of ["demo_enrollment_panel", "demo_payments_balances", "demo_online_enrollment"]) {
      const form = new FormData(); form.set("file", new File([bytes], `${slot}.mp4`, { type: "video/mp4" }));
      ok(`029 upload ${slot}`, (await api(`/api/commercial-resources/videos/${slot}`, { method: "PUT", body: form })).res.ok);
    }
    const state = async label => (await sql`SELECT c.id, c.contact_id, c.handoff_at, c.handoff_reason, c.ai_enabled, l.id AS lead_id, l.demo_shown_at, l.price_presented_at, l.payment_instructions_sent_at, l.automation_lane FROM conversation c JOIN contact ct ON ct.id=c.contact_id AND ct.organization_id=c.organization_id JOIN lead l ON l.contact_id=ct.id AND l.organization_id=c.organization_id WHERE c.organization_id=${org} AND ct.name=${label}`)[0];
    const messages = async cv => await sql`SELECT * FROM message WHERE organization_id=${org} AND conversation_id=${cv} AND direction='out' ORDER BY created_at`;
    const jobs = async cv => await sql`SELECT * FROM sales_follow_up_job WHERE organization_id=${org} AND conversation_id=${cv} ORDER BY created_at`;
    const freshIdentity = () => ({ from: `51997${String(Date.now()).slice(-5)}${String(++counter).padStart(3, "0")}` });
    const inbound = async (label, text, identity = freshIdentity(), extra = {}) => {
      const payload = { phoneNumberId: pn, name: label, text, ...identity, waMessageId: `wamid.safety.in.${Date.now()}.${++counter}`, ...extra };
      const res = await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify(payload) });
      if (!res.res.ok) throw new Error(`029 inbound ${label} ${res.res.status}`);
      const s = await waitFor(async () => {
        const [message] = await sql`SELECT conversation_id FROM message WHERE organization_id=${org} AND wa_message_id=${payload.waMessageId} AND direction='in'`;
        return message ? state(label) : null;
      }); if (!s) throw new Error(`029 missing persisted inbound ${label}`);
      return { ...s, identity, payload };
    };
    const outbound = async cv => {
      const rows = await waitFor(async () => { const all = await messages(cv); return all.some(m => m.wa_message_id) ? all : null; }, 45000);
      if (!rows) throw new Error(`029 no outbound ${cv}`); return rows;
    };
    const silent = async label => {
      const s = await waitFor(async () => { const s = await state(label); return s?.handoff_at ? s : null; }, 45000);
      if (!s) throw new Error(`029 no handoff ${label}`); return s;
    };
    const settle = async () => pause(Number(process.env.AGENT_COALESCE_MS ?? 1000) + 1200);
    // Incident 1: opaque media never reaches a decision/writer, including caption.
    for (const type of ["audio", "image", "video", "document", "sticker", "location"]) {
      const before = [outbox.length, jevCalls, writerCalls];
      const r = await inbound(`opaque-${type}`, undefined, undefined, { type, caption: "Muéstrame pagos", mediaId: `mock-${type}`, filename: "fixture.bin" });
      const s = await silent(`opaque-${type}`); await settle();
      const assets = await sql`SELECT m.id, m.media_asset_id FROM message m WHERE m.organization_id=${org} AND m.conversation_id=${r.id} AND direction='in'`;
      ok(`029 opaque ${type} persisted and silent handoff`, s.handoff_reason === "unsupported_media" && assets.length === 1 && !!assets[0].media_asset_id && (await messages(r.id)).length === 0 && outbox.length === before[0] && jevCalls === before[1] && writerCalls === before[2]);
      ok(`029 opaque ${type} zero jobs/facts`, (await jobs(r.id)).length === 0 && !s.demo_shown_at && !s.price_presented_at);
    }
    const mediaCancel = await inbound("media-cancels", "Necesito controlar mis alumnos");
    const mediaCancelMessage = (await outbound(mediaCancel.id))[0];
    await statusRaw(mediaCancelMessage.wa_message_id, "sent");
    ok("029 first sent confirms awaiting_reply job", (await jobs(mediaCancel.id)).filter(j => j.status === "pending").length === 1);
    const mediaBefore = [outbox.length, jevCalls, writerCalls];
    await inbound("media-cancels", undefined, mediaCancel.identity, { type: "audio", mediaId: "mock-cancel-audio" });
    await silent("media-cancels"); await settle();
    ok("029 opaque audio cancels existing followup silently", (await jobs(mediaCancel.id)).every(j => !["pending", "processing"].includes(j.status)) && outbox.length === mediaBefore[0] && jevCalls === mediaBefore[1] && writerCalls === mediaBefore[2]);
    // Incident 2: provider suspended, newer inbound supersedes the old turn.
    action = "ask_more_questions"; suspendNext = true;
    const burstStart = outbox.length;
    const burst = await inbound("burst", "FIRST-SAFETY necesito controlar alumnos");
    if (!await waitFor(() => suspended, 30000)) throw new Error("029 provider never suspended");
    await inbound("burst", "LATEST-SAFETY necesito controlar pagos", burst.identity);
    releaseProvider(); const burstMessages = await outbound(burst.id); await settle();
    ok("029 burst sole latest response", burstMessages.length === 1 && burstMessages[0].text.includes("LATEST-SAFETY") && outbox.length === burstStart + 1);
    legacy = true; suspendWriterNext = true;
    await sql`UPDATE agent_profile SET sales_orchestrator_enabled=false WHERE organization_id=${org}`;
    const legacyBefore = outbox.length;
    const legacyBurst = await inbound("legacy-burst", "FIRST-SAFETY necesito controlar alumnos");
    if (!await waitFor(() => suspended, 30000)) throw Error("029 legacy provider never suspended");
    await inbound("legacy-burst", "LATEST-SAFETY necesito controlar pagos", legacyBurst.identity);
    releaseProvider(); const legacyMessages = await outbound(legacyBurst.id); await settle();
    ok("029 legacy burst sole latest response", legacyMessages.length === 1 && legacyMessages[0].text.includes("LATEST-SAFETY") && outbox.length === legacyBefore + 1);
    legacy = false;
    await sql`UPDATE agent_profile SET sales_orchestrator_enabled=true WHERE organization_id=${org}`;
    // Incident 3: durable same-slot reservation blocks repeat, including pending.
    action = "show_operations_demo";
    const demo = await inbound("repeat-demo", "Muéstrame pagos y saldos"); const demoMessages = await outbound(demo.id);
    ok("029 Graph wamid pending, no demo fact/job", demoMessages[0].status === "pending" && !(await state("repeat-demo")).demo_shown_at && (await jobs(demo.id)).length === 0);
    await inbound("repeat-demo", "Muéstrame nuevamente pagos y saldos", demo.identity); await silent("repeat-demo"); await settle();
    ok("029 same slot twice exactly one video no orphan caption", (await messages(demo.id)).length === 1 && outbox.filter(m => m.body.type === "video").length === 1);
    const distinct = await inbound("distinct-slots", "Muéstrame matrícula y alumnos");
    const firstDemo = (await outbound(distinct.id))[0];
    await statusRaw(firstDemo.wa_message_id, "sent");
    const firstDemoFact = await waitFor(async () => (await state("distinct-slots"))?.demo_shown_at);
    ok("029 successful first demo status confirms fact and job", !!firstDemoFact && (await jobs(distinct.id)).length === 1);
    action = "show_online_enrollment_demo";
    await inbound("distinct-slots", "Muéstrame matrícula online", distinct.identity);
    const differentDemo = await waitFor(async () => { const rows = await messages(distinct.id); return rows.length === 2 && rows[1].wa_message_id ? rows[1] : null; }, 45000);
    if (!differentDemo) throw Error("029 different demo slot was blocked");
    await statusRaw(differentDemo.wa_message_id, "delivered");
    ok("029 different slots allowed", (await messages(distinct.id)).filter(m => m.type === "video").length === 2);
    await statusRaw(differentDemo.wa_message_id, "failed");
    ok("029 failed newer demo preserves independent earlier fact", String((await state("distinct-slots")).demo_shown_at) === String(firstDemoFact));
    // Incidents 4 and 5: opaque BSUID recipient versus normalized phone to.
    action = "ask_more_questions";
    const bsuid = await inbound("bsuid", "Necesito controlar mis alumnos", { fromUserId: "BSUID-SAFETY-ONLY" }); await outbound(bsuid.id);
    const bsuidBody = outbox.at(-1).body;
    ok("029 BSUID only uses recipient, never to", bsuidBody.recipient === "BSUID-SAFETY-ONLY" && !bsuidBody.to);
    const phone = await inbound("phone", "Necesito controlar alumnos", { from: "5215555019973" }); await outbound(phone.id);
    ok("029 phone only normalized to", outbox.at(-1).body.to === "525555019973" && !outbox.at(-1).body.recipient);
    // Incident 6: failed131026 leaves no commercial effects or retry.
    action = "present_price";
    const failed = await inbound("failed131026", "¿Cuál es el precio?"); const failMessage = (await outbound(failed.id))[0];
    ok("029 price pending zero facts/jobs", !(await state("failed131026")).price_presented_at && (await jobs(failed.id)).length === 0);
    const beforeFail = outbox.length; await statusRaw(failMessage.wa_message_id, "failed"); await silent("failed131026"); await settle();
    const failedState = await state("failed131026");
    ok("029 failed131026 terminal visible zero facts/jobs/retry", (await messages(failed.id))[0].status === "failed" && !!(await messages(failed.id))[0].error && !failedState.price_presented_at && (await jobs(failed.id)).length === 0 && failedState.automation_lane === "human" && outbox.length === beforeFail);
    await statusRaw(failMessage.wa_message_id, "read");
    ok("029 success after failed cannot authorize effects", !(await state("failed131026")).price_presented_at && (await jobs(failed.id)).length === 0);
    // Incident 7: first successful webhook applies once, arbitrary order/duplicates.
    const success = await inbound("confirmed", "¿Cuál es el precio?"); const successMessage = (await outbound(success.id))[0];
    await statusRaw(successMessage.wa_message_id, "read");
    const confirmed = await waitFor(async () => { const s = await state("confirmed"); return s?.price_presented_at && (await jobs(success.id)).length === 1 ? s : null; });
    ok("029 first read confirms price and one job", !!confirmed);
    for (const status of ["sent", "delivered", "read", "read", "sent"]) await statusRaw(successMessage.wa_message_id, status);
    ok("029 duplicate out-of-order statuses exactly once", (await jobs(success.id)).length === 1 && String((await state("confirmed")).price_presented_at) === String(confirmed?.price_presented_at));
    await statusRaw(successMessage.wa_message_id, "failed");
    ok("029 late failed cancels effects linked to outbound", !(await state("confirmed")).price_presented_at && !(await jobs(success.id)).some(j => ["pending", "processing"].includes(j.status)));
    // Early receipt arrives before Graph response; replay must close the loss window.
    earlyStatus = true;
    const early = await inbound("early-status", "¿Cuál es el precio?"); await outbound(early.id); earlyStatus = false;
    ok("029 early delivered before Graph response reconciles", !!await waitFor(async () => (await state("early-status"))?.price_presented_at && (await jobs(early.id)).length === 1));
    const delayed = await inbound("delayed-status", "¿Cuál es el precio?"); const delayedMessage = (await outbound(delayed.id))[0];
    await sql`UPDATE conversation SET last_inbound_at=now()-interval '25 hours' WHERE organization_id=${org} AND id=${delayed.id}`;
    const delayedBefore = outbox.length;
    ok("029 closed window cannot send while pending status", (await api(`/api/conversations/${delayed.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Fuera de ventana" }) })).res.status === 409);
    await statusRaw(delayedMessage.wa_message_id, "sent");
    ok("029 delayed successful status confirms fact without reopening window", !!(await state("delayed-status")).price_presented_at && outbox.length === delayedBefore && (await api(`/api/conversations/${delayed.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Sigue fuera de ventana" }) })).res.status === 409);
    // Cancellation gates: newer inbound / manual reply must prevent late status scheduling.
    for (const kind of ["inbound", "manual"]) {
      const r = await inbound(`late-${kind}`, "¿Cuál es el precio?"); const m = (await outbound(r.id))[0];
      if (kind === "inbound") {
        suspendNext = true;
        await inbound(`late-${kind}`, "Nueva evidencia vigente del prospecto", r.identity);
        if (!await waitFor(() => suspended, 30000)) throw Error("029 new turn was not suspended");
      } else ok("029 manual reply happy", (await api(`/api/conversations/${r.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Respuesta del operador" }) })).res.ok);
      await statusRaw(m.wa_message_id, "sent");
      ok(`029 late status after ${kind} zero stale jobs`, !(await jobs(r.id)).some(j => ["pending", "processing"].includes(j.status)));
      if (kind === "inbound") {
        releaseProvider();
        if (!await waitFor(async () => (await messages(r.id)).length === 2, 45000)) throw Error("029 natural inbound did not resume latest turn");
      }
    }
    suspendWriterNext = true;
    const manualDuring = await inbound("manual-during-writer", "¿Cuál es el precio?");
    if (!await waitFor(() => suspended, 30000)) throw Error("029 writer never suspended for manual test");
    const manualBefore = outbox.length;
    ok("029 manual during writer accepted", (await api(`/api/conversations/${manualDuring.id}/messages`, { method: "POST", body: JSON.stringify({ text: "El operador ya respondió" }) })).res.ok);
    releaseProvider(); await settle();
    ok("029 manual during writer suppresses stale AI response/facts/jobs", outbox.length === manualBefore + 1 && (await messages(manualDuring.id)).length === 1 && !(await state("manual-during-writer")).price_presented_at && (await jobs(manualDuring.id)).length === 0);
    const noGraph = outbox.length;
    const preview = await api("/api/lab/preview", { method: "POST", body: JSON.stringify({ mode: "published", conversation: [{ from: "lead", text: "¿Cuál es el precio?" }] }) });
    ok("029 sandbox local success zero Graph/jobs", preview.res.ok && outbox.length === noGraph);
    await sql`UPDATE conversation SET last_inbound_at=now()-interval '25 hours' WHERE organization_id=${org} AND id=${phone.id}`;
    ok("029 24h unhappy no Graph", (await api(`/api/conversations/${phone.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Fuera de ventana" }) })).res.status === 409 && outbox.length === noGraph);
    const other = await api("/api/auth/organization/create", { method: "POST", body: JSON.stringify({ name: "Safety other", slug: `safety-other-${Date.now()}` }) });
    await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: other.json.id }) });
    ok("029 tenant API cannot read foreign thread", (await api(`/api/conversations/${success.id}/messages`)).res.status === 404);
    ok("029 tenant API cannot send foreign thread", (await api(`/api/conversations/${success.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Foreign" }) })).res.status === 422 && outbox.length === noGraph);
    await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: org }) });
    // Physical PostgreSQL constraints: simultaneous slot reservations and tenant FK.
    const reservationResults = await Promise.allSettled([1, 2].map(n => sql`
      INSERT INTO sales_demo_reservation (id, organization_id, conversation_id, slot, inbound_message_id)
      VALUES (${`sdr_physical_${Date.now()}_${n}`}, ${org}, ${bsuid.id}, 'demo_enrollment_panel',
        (SELECT latest_inbound_message_id FROM conversation WHERE organization_id=${org} AND id=${bsuid.id}))`));
    ok("029 PG concurrent reservation exactly one winner", reservationResults.filter(r => r.status === "fulfilled").length === 1 && reservationResults.filter(r => r.status === "rejected" && r.reason.code === "23505").length === 1);
    let foreignFk = false;
    try { await sql`INSERT INTO sales_demo_reservation (id, organization_id, conversation_id, slot, inbound_message_id)
      VALUES (${`sdr_foreign_${Date.now()}`}, ${other.json.id}, ${bsuid.id}, 'demo_payments_balances', 'fixture-inbound')`; }
    catch (err) { foreignFk = err.code === "23503"; }
    ok("029 PG composite tenant FK rejects foreign conversation", foreignFk);
    let receiptUnique = false;
    try { await sql`INSERT INTO wa_status_receipt (id, organization_id, wa_message_id, status)
      VALUES (${`wsr_duplicate_${Date.now()}`}, ${org}, ${successMessage.wa_message_id}, 'read')`; }
    catch (err) { receiptUnique = err.code === "23505"; }
    ok("029 PG status receipt uniqueness enforced", receiptUnique);
    const rollback = new Error("SAFETY_TRIGGER_ROLLBACK");
    try { await sql.begin(async tx => {
      await tx`UPDATE conversation SET ai_enabled=false WHERE organization_id=${org} AND id=${bsuid.id}`;
      const [paused] = await tx`SELECT invalidated_at::text AS invalidated FROM sales_outbound_delivery WHERE organization_id=${org} AND conversation_id=${bsuid.id}`;
      ok("029 PG pause trigger invalidates pending ledger", !!paused?.invalidated);
      await tx`UPDATE conversation SET ai_enabled=true WHERE organization_id=${org} AND id=${bsuid.id}`;
      const [resumed] = await tx`SELECT invalidated_at::text AS invalidated FROM sales_outbound_delivery WHERE organization_id=${org} AND conversation_id=${bsuid.id}`;
      ok("029 PG reactivate cannot restore invalidated authorization", resumed?.invalidated === paused?.invalidated);
      throw rollback;
    }); } catch (err) { if (err !== rollback) throw err; }
    // Observe the operational queue and failed message in the actual browser.
    const { chromium } = await import("playwright"); browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(getCookie().split("; ").filter(Boolean).map(entry => { const n = entry.indexOf("="); return { name: entry.slice(0, n), value: entry.slice(n + 1), url: BASE }; }));
    const page = await context.newPage(); await page.goto(`${BASE}/inbox`);
    const row = page.locator("[data-testid='conversation-item']", { hasText: "failed131026" }); await row.waitFor({ timeout: 30000 });
    ok("029 failed131026 visible Por atender", (await row.textContent()).includes("Por atender"));
    await row.click(); await page.locator("[data-testid='attention-state']").waitFor();
    ok("029 UI human attention after delivery failure", (await page.locator("[data-testid='attention-state']").textContent()).includes("Por atender"));
    ok("029 UI delivery failure reason readable", (await page.locator("[data-testid='attention-reason']").textContent()).includes("Revisa el error"));
    for (const [label, expected] of [["opaque-audio", "La IA no puede interpretar este archivo"], ["repeat-demo", "Esta demo ya se intentó enviar"]]) {
      await page.locator("[data-testid='conversation-item']", { hasText: label }).click();
      await page.getByTestId("attention-reason").filter({ hasText: expected }).waitFor();
      ok(`029 UI readable reason ${label}`, (await page.getByTestId("attention-reason").textContent()).includes(expected));
    }
  } finally {
    releaseProvider?.(); await browser?.close();
    if (previousOrg) await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: previousOrg }) });
    await sql.end(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  }
}
