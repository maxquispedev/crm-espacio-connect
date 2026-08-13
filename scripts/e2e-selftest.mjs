/**
 * Self-test E2E de comportamiento — conduce la app real en localhost con los
 * mocks (wa-mock + ai-mock) por las superficies de usuario, en vez de darle
 * el guion al humano. Cubre tests/e2e/us-bsuid.md y tests/e2e/us-bot-api.md.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      BOT_API_KEY configurada y BD migrada
 *   2) node --env-file=.env scripts/e2e-selftest.mjs
 *
 * Sale con código 1 si algún check falla (apto para CI o para el gate previo
 * a declarar "Hecho").
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      // Better Auth valida Origin (CSRF) en los endpoints de auth.
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

function bot(path, opts = {}) {
  return api(path, {
    ...opts,
    headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PN = "PN-E2E-1";
const PN_B = "PN-E2E-2";

function parseSseBlock(block) {
  let type = "message";
  let dataLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) type = line.slice("event:".length).trim();
    else if (line.startsWith("data:"))
      dataLine += line.slice("data:".length).trim();
  }
  if (!dataLine) return null;
  try {
    return { type, data: JSON.parse(dataLine) };
  } catch {
    return { type, data: dataLine };
  }
}

function orgListFrom(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.organizations)) return json.organizations;
  return [];
}

/**
 * Abre GET /api/events, espera el comentario de conexión, dispara `trigger`
 * y resuelve el primer evento que cumpla `predicate`.
 */
async function collectSse(predicate, { timeoutMs = 12000, trigger } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(`${BASE}/api/events`, {
    headers: {
      origin: BASE,
      accept: "text/event-stream",
      ...(cookie ? { cookie } : {}),
    },
    signal: ac.signal,
  });
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    return { ok: false, status: res.status, events: [], match: null };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events = [];
  let triggered = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const block of chunks) {
        if (!triggered && trigger && /(^|\n): (conectado|ping)/.test(block)) {
          triggered = true;
          void trigger();
        }
        const ev = parseSseBlock(block);
        if (!ev) continue;
        events.push(ev);
        if (predicate(ev)) {
          clearTimeout(timer);
          ac.abort();
          return { ok: true, status: res.status, events, match: ev };
        }
      }
    }
  } catch {
    // abort por timeout o match
  } finally {
    clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {}
  }
  return { ok: res.ok, status: res.status, events, match: null };
}

async function main() {
  if (!BOT_KEY || BOT_KEY.length < 16) {
    console.error(
      "BOT_API_KEY ausente o corta (<16): los checks de /api/bot/* no pueden correr."
    );
    process.exit(1);
  }

  console.log("== Setup: registro/login + conexión WhatsApp ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    // Re-corrida: el registro se cierra tras la primera organización.
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
      token: "tok-e2e",
    }),
  });
  ok(
    "conexión WhatsApp guardada (vía wa-mock)",
    conn.res.ok,
    JSON.stringify(conn.json)
  );
  const connGet = await api("/api/settings/whatsapp");
  const esCfg = connGet.json?.embeddedSignup;
  ok(
    "GET expone Embedded Signup público (appId/configId) sin App Secret",
    !!esCfg &&
      Object.prototype.hasOwnProperty.call(esCfg, "appId") &&
      Object.prototype.hasOwnProperty.call(esCfg, "configId") &&
      !JSON.stringify(esCfg).toLowerCase().includes("secret") &&
      !JSON.stringify(connGet.json).includes("tok-e2e"),
    JSON.stringify(esCfg)
  );
  ok(
    "GET no devuelve el token completo (solo last4)",
    connGet.json?.connection?.tokenLast4 === "e2e" &&
      !JSON.stringify(connGet.json).includes("tok-e2e")
  );

  console.log("\n== us5: Embedded Signup (API + wa-mock) ==");
  const esEmpty = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({}),
  });
  ok("ES body inválido → 422", esEmpty.res.status === 422);

  const esNoIds = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({ code: "code-e2e" }),
  });
  ok("ES sin wabaId/phoneNumberId → 422", esNoIds.res.status === 422);

  const esBadCode = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({
      code: "code-invalid",
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
    }),
  });
  ok(
    "ES code inválido no conecta",
    !esBadCode.res.ok && esBadCode.res.status !== 500,
    JSON.stringify(esBadCode.json)
  );
  ok(
    "respuesta ES de error no incluye token",
    !JSON.stringify(esBadCode.json).includes("EAAG") &&
      !JSON.stringify(esBadCode.json).includes("tok-e2e")
  );

  const esNosub = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({
      code: "code-e2e",
      wabaId: "WABA-NOSUB",
      phoneNumberId: PN,
    }),
  });
  const nosubCode = esNosub.json?.error?.code;
  ok(
    "ES subscribed_apps fallido no deja conectado (o no configurado en env)",
    nosubCode === "subscribe_failed" || nosubCode === "not_configured" || nosubCode === "oauth_failed",
    JSON.stringify(esNosub.json)
  );

  const esOk = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({
      code: "code-e2e",
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
    }),
  });
  const esOkCode = esOk.json?.error?.code;
  const esConfigured = esOk.res.ok;
  ok(
    "ES camino feliz vía wa-mock (si App ID/Secret están en env)",
    esConfigured || esOkCode === "not_configured" || esOkCode === "oauth_failed",
    JSON.stringify(esOk.json)
  );
  if (esConfigured) {
    ok(
      "ES éxito no devuelve el token, sí last4 y display",
      esOk.json?.ok === true &&
        typeof esOk.json?.tokenLast4 === "string" &&
        esOk.json.tokenLast4.length === 4 &&
        !JSON.stringify(esOk.json).includes("EAAG-mock-oauth")
    );
    const afterEs = await api("/api/settings/whatsapp");
    ok(
      "tras ES el GET sigue sin el token completo",
      afterEs.json?.connection?.status === "connected" &&
        !JSON.stringify(afterEs.json).includes("EAAG-mock-oauth")
    );
  }

  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  console.log("\n== us-bsuid: inbound sin wa_id ==");
  const inb1 = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  ok("inbound BSUID entregado", inb1.res.ok, JSON.stringify(inb1.json));
  await sleep(1200);

  let convs = (await api("/api/conversations")).json?.conversations ?? [];
  const bsuidConv = convs.find((c) => c.contact.name === "Dueña Dental");
  ok("conversación con nombre de perfil (no el BSUID crudo)", !!bsuidConv);
  ok("contacto BSUID sin teléfono", bsuidConv?.contact.phone === null);

  const reply = await api(`/api/conversations/${bsuidConv?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "¡Hola! Te atendemos enseguida" }),
  });
  ok("respuesta a contacto BSUID enviable", reply.res.ok, JSON.stringify(reply.json));

  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el destinatario del envío es el BSUID",
    outbox.some((o) => o.to === "bsu_e2e_1"),
    JSON.stringify(outbox.map((o) => o.to))
  );

  // Idempotencia: re-entrega del mismo wa_message_id
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  await sleep(800);
  const msgs =
    (await api(`/api/conversations/${bsuidConv?.id}/messages`)).json?.messages ??
    [];
  const inCount = msgs.filter((m) => m.direction === "in").length;
  ok("webhook duplicado no duplica mensajes", inCount === 1, `in=${inCount}`);

  console.log("\n== us-bsuid: reconciliación 521/52 ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214621349768",
      name: "Kevin MX",
      text: "uno",
    }),
  });
  await sleep(800);
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from: "524621349768", text: "dos" }),
  });
  await sleep(800);
  const contacts =
    (await api("/api/contacts?q=Kevin%20MX")).json?.contacts ?? [];
  ok(
    "521 y 52 resuelven a UN solo contacto",
    contacts.length === 1,
    `n=${contacts.length}`
  );

  const mxConv = ((await api("/api/conversations")).json?.conversations ?? []).find(
    (c) => c.contact.name === "Kevin MX"
  );
  ok("el contacto reconciliado conserva su conversación", !!mxConv);

  console.log("\n== us-bot-api: autorización ==");
  const noKey = await api("/api/bot/media/media123");
  ok("media sin API key → 401", noKey.res.status === 401);
  const badKey = await api("/api/bot/media/media123", {
    headers: { "x-api-key": "x".repeat(BOT_KEY.length) },
  });
  ok("media con API key equivocada → 401", badKey.res.status === 401);
  const resetNoKey = await api("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: mxConv?.id }),
  });
  ok("reset sin API key → 401", resetNoKey.res.status === 401);

  console.log("\n== us-bot-api: typing + leído ==");
  const convId = mxConv?.id;
  const outboxBeforeTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const typ = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/typing → ok:true (leído + escribiendo…)",
    typ.res.ok && typ.json?.ok === true,
    JSON.stringify(typ.json)
  );
  const outboxAfterTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "typing NO contamina el outbox",
    outboxAfterTyping === outboxBeforeTyping,
    `antes=${outboxBeforeTyping} después=${outboxAfterTyping}`
  );

  const typ404 = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe" }),
  });
  ok("typing con conversación inexistente → 404", typ404.res.status === 404);

  console.log("\n== us-bot-api: media proxy ==");
  const med = await bot("/api/bot/media/media123");
  const medBytes = med.res.ok ? await med.res.arrayBuffer() : new ArrayBuffer(0);
  ok(
    "GET /api/bot/media/{id} → binario con content-type",
    med.res.ok &&
      medBytes.byteLength > 0 &&
      (med.res.headers.get("content-type") ?? "").includes("image"),
    `status=${med.res.status} bytes=${medBytes.byteLength}`
  );
  const medBad = await bot("/api/bot/media/no-es-media");
  ok(
    "mediaId que Graph no reconoce → error tipado, no 500",
    medBad.res.status === 404 || medBad.res.status === 502,
    `status=${medBad.res.status}`
  );

  console.log("\n== us-bot-api: IA pausada y reset ==");
  const pause = await api(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled: false }),
  });
  ok("IA pausada desde la bandeja", pause.res.ok, JSON.stringify(pause.json));

  const typPaused = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "typing con IA pausada → ok:false ai_paused (no toca Meta)",
    typPaused.res.ok &&
      typPaused.json?.ok === false &&
      typPaused.json?.reason === "ai_paused",
    JSON.stringify(typPaused.json)
  );

  const msgsBeforeReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  const rst = await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/reset → ok:true",
    rst.res.ok && rst.json?.ok === true,
    JSON.stringify(rst.json)
  );
  await sleep(400);
  convs = (await api("/api/conversations")).json?.conversations ?? [];
  const afterReset = convs.find((c) => c.id === convId);
  ok(
    "reset reactiva la IA (sale del handoff)",
    afterReset?.aiEnabled === true && !afterReset?.handoffAt,
    JSON.stringify({
      aiEnabled: afterReset?.aiEnabled,
      handoffAt: afterReset?.handoffAt,
    })
  );
  const msgsAfterReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  ok(
    "el reset conserva el historial (auditoría)",
    msgsAfterReset === msgsBeforeReset,
    `antes=${msgsBeforeReset} después=${msgsAfterReset}`
  );

  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];
  const detail = (await api(`/api/contacts/${afterReset?.contact.id}`)).json;
  ok(
    "reset regresa el lead a la primera etapa",
    !detail?.lead || detail?.stage?.id === firstStage?.id,
    `etapa=${detail?.stage?.name} esperada=${firstStage?.name}`
  );

  console.log("\n== 008: paridad inbox — echoes de coexistence (US1) ==");
  const LEAD = "5214627008001"; // canónica: 524627008001

  // Un inbound primero: la conversación existe y la ventana queda abierta.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      name: "Lead 008",
      text: "hola, quiero informes",
      waMessageId: "wamid.e2e.008.in.1",
    }),
  });
  await sleep(1200);
  const findConv008 = async () =>
    (((await api("/api/conversations")).json?.conversations) ?? []).find(
      (c) => c.contact.phone === "524627008001"
    );
  let conv008 = await findConv008();
  ok("conversación del lead 008 creada", Boolean(conv008), "sin conversación");
  const inboundAtBefore = conv008?.lastInboundAt;

  // Echo: el dueño contesta A MANO desde la app del teléfono.
  const echo1 = await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  ok("echo entregado al webhook", echo1.res.ok, JSON.stringify(echo1.json));
  await sleep(900);

  const msgs1 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const manual1 = msgs1.find((m) => m.text === "te contesto yo, dame un minuto");
  ok(
    "el mensaje manual aparece como saliente origin=manual",
    manual1?.direction === "out" && manual1?.origin === "manual" && manual1?.status === "sent",
    JSON.stringify(manual1)
  );

  conv008 = await findConv008();
  ok(
    "la IA quedó pausada con handoff manual_reply",
    conv008?.aiEnabled === false && conv008?.handoffReason === "manual_reply",
    JSON.stringify({ aiEnabled: conv008?.aiEnabled, reason: conv008?.handoffReason })
  );
  ok(
    "el echo NO tocó la ventana de 24 h (lastInboundAt intacto)",
    conv008?.lastInboundAt === inboundAtBefore,
    `${inboundAtBefore} → ${conv008?.lastInboundAt}`
  );

  // Idempotencia: el mismo echo otra vez no duplica.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  await sleep(700);
  const msgs2 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo duplicado (mismo wamid) no duplica el mensaje",
    msgs2.filter((m) => m.text === "te contesto yo, dame un minuto").length === 1
  );

  // Variante defensiva: echoes bajo la clave `messages`.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "segundo mensaje manual",
      waMessageId: "wamid.e2e.008.echo.2",
      useMessagesKey: true,
    }),
  });
  await sleep(700);
  const msgs3 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo bajo la clave `messages` también se ingiere (parser tolerante)",
    msgs3.some((m) => m.text === "segundo mensaje manual" && m.origin === "manual")
  );

  // Echo hacia un número SIN conversación previa → la crea.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: "5214627008002",
      text: "hola, te escribo del anuncio",
      waMessageId: "wamid.e2e.008.echo.3",
    }),
  });
  await sleep(700);
  const convNew = (((await api("/api/conversations")).json?.conversations) ?? []).find(
    (c) => c.contact.phone === "524627008002"
  );
  ok("echo a número nuevo crea contacto y conversación", Boolean(convNew));

  // Reactivación desde el CRM (flujo existente de handoff).
  const react = await api(`/api/conversations/${conv008.id}`, {
    method: "PATCH",
    body: JSON.stringify({ reactivate: true }),
  });
  conv008 = await findConv008();
  ok(
    "reactivar la IA desde el CRM limpia el handoff",
    react.res.ok && conv008?.aiEnabled === true && !conv008?.handoffReason
  );

  console.log("\n== 008: enviar adjuntos desde el composer (US2) ==");
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);
  const mediaForm = new FormData();
  mediaForm.set(
    "file",
    new Blob([JPEG_BYTES], { type: "image/jpeg" }),
    "local.jpg"
  );
  mediaForm.set("caption", "mira nuestro local");
  const upRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: mediaForm,
  });
  const upJson = await upRes.json().catch(() => null);
  ok("imagen con caption enviada (201)", upRes.status === 201, JSON.stringify(upJson));

  const msgs4 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentImg = msgs4.find((m) => m.media?.caption === "mira nuestro local");
  ok(
    "el saliente con imagen trae asset disponible y origin=operator",
    sentImg?.type === "image" &&
      sentImg?.origin === "operator" &&
      sentImg?.media?.fetchStatus === "available",
    JSON.stringify(sentImg)
  );

  const imgBin = await fetch(`${BASE}/api/media/${sentImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok(
    "GET /api/media/{id} sirve el binario con su content-type",
    imgBin.ok && (imgBin.headers.get("content-type") ?? "").includes("image/jpeg")
  );

  const outbox008 = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el envío llegó a Graph como type=image con media id subido",
    outbox008.some((o) => o.type === "image" && JSON.stringify(o.body).includes("media-up-"))
  );

  // Camino infeliz: archivo que excede el límite (imagen > 5 MB) → 413 previo.
  const bigForm = new FormData();
  bigForm.set(
    "file",
    new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "image/png" }),
    "grande.png"
  );
  const bigRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: bigForm,
  });
  ok("imagen de 6 MB → 413 too_large ANTES de enviar", bigRes.status === 413);

  // Ubicación (payload estructurado, sin archivo).
  const locRes = await api(`/api/conversations/${conv008.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      type: "location",
      location: { latitude: 21.019, longitude: -101.257, name: "Oficina Central" },
    }),
  });
  ok("ubicación enviada", locRes.res.ok, JSON.stringify(locRes.json));
  const msgs5 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentLoc = msgs5.find((m) => m.type === "location" && m.direction === "out");
  ok(
    "la ubicación viaja como payload (lat/long/name) sin binario",
    sentLoc?.media?.kind === "location" && sentLoc?.media?.payload?.latitude === 21.019,
    JSON.stringify(sentLoc?.media)
  );
  const outboxLoc = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "Graph recibió type=location",
    outboxLoc.some((o) => o.type === "location")
  );

  console.log("\n== 008: previews de adjuntos entrantes (US3) ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "media-e2e-img-1",
      caption: "foto de mi negocio",
      waMessageId: "wamid.e2e.008.in.img",
    }),
  });
  await sleep(1600); // ingesta + descarga in-process del binario
  const msgs6 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inImg = msgs6.find((m) => m.media?.caption === "foto de mi negocio");
  ok(
    "imagen entrante queda disponible tras la descarga in-process",
    inImg?.direction === "in" &&
      inImg?.media?.kind === "image" &&
      inImg?.media?.fetchStatus === "available",
    JSON.stringify(inImg?.media)
  );
  const inImgBin = await fetch(`${BASE}/api/media/${inImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok("el binario entrante se sirve desde el volumen local", inImgBin.ok);

  // Ubicación entrante: payload directo, sin binario (404 en /api/media).
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "location",
      location: { latitude: 20.5, longitude: -100.8, name: "Mi taller" },
      waMessageId: "wamid.e2e.008.in.loc",
    }),
  });
  await sleep(900);
  const msgs7 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inLoc = msgs7.find((m) => m.type === "location" && m.direction === "in");
  ok(
    "ubicación entrante trae payload directo",
    inLoc?.media?.payload?.name === "Mi taller",
    JSON.stringify(inLoc?.media)
  );

  // Camino infeliz: media cuya descarga falla (metadata sin url) → failed,
  // el mensaje se conserva y /api/media responde 410.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "broken-no-url",
      waMessageId: "wamid.e2e.008.in.broken",
    }),
  });
  await sleep(1600);
  const msgs8 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const broken = msgs8.find((m) => m.id !== inImg?.id && m.media?.fetchStatus === "failed");
  ok(
    "descarga fallida degrada a failed sin perder el mensaje",
    Boolean(broken),
    JSON.stringify(msgs8.filter((m) => m.media).map((m) => m.media))
  );
  if (broken) {
    const goneRes = await fetch(`${BASE}/api/media/${broken.media.assetId}`, {
      headers: { cookie, origin: BASE },
    });
    ok("asset fallido → 410 gone en /api/media", goneRes.status === 410);
  }

  // Echo CON adjunto (AC-5 de US1): la foto que el dueño mandó desde el cel.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      type: "image",
      mediaId: "media-e2e-echo-img",
      caption: "así quedaría tu logo",
      waMessageId: "wamid.e2e.008.echo.img",
    }),
  });
  await sleep(1600);
  const msgs9 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const echoImg = msgs9.find((m) => m.media?.caption === "así quedaría tu logo");
  ok(
    "echo con imagen: manual + asset descargado y previsualizable",
    echoImg?.origin === "manual" && echoImg?.media?.fetchStatus === "available",
    JSON.stringify(echoImg?.media)
  );

  console.log("\n== coexistence: historial y agenda (history / smb_app_state_sync) ==");
  const HIST_LEAD = "5214627009001"; // → 524627009001
  const HIST_BIZ = "5215500000000";
  const tsOld = 1_690_000_000;
  const tsMid = 1_700_000_000;
  const tsNew = 1_700_002_000;

  const hist1 = await api("/api/dev/wa-mock/history", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      displayPhoneNumber: HIST_BIZ,
      threads: [
        {
          id: HIST_LEAD,
          messages: [
            {
              from: HIST_LEAD,
              id: "wamid.e2e.hist.in.2",
              timestamp: tsNew,
              text: "mensaje reciente del historial",
              historyStatus: "READ",
            },
            {
              from: HIST_BIZ,
              to: HIST_LEAD,
              id: "wamid.e2e.hist.out.1",
              timestamp: tsMid,
              text: "respuesta vieja del negocio",
              historyStatus: "DELIVERED",
            },
          ],
        },
      ],
    }),
  });
  ok("webhook history entregado", hist1.res.ok, JSON.stringify(hist1.json));
  await sleep(1200);

  const histOld = await api("/api/dev/wa-mock/history", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      displayPhoneNumber: HIST_BIZ,
      chunkOrder: 0,
      threads: [
        {
          id: HIST_LEAD,
          messages: [
            {
              from: HIST_LEAD,
              id: "wamid.e2e.hist.in.1",
              timestamp: tsOld,
              text: "mensaje más viejo",
              historyStatus: "READ",
            },
          ],
        },
      ],
    }),
  });
  ok("chunk histórico más viejo entregado", histOld.res.ok, JSON.stringify(histOld.json));
  await sleep(1200);

  const histDup = await api("/api/dev/wa-mock/history", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      displayPhoneNumber: HIST_BIZ,
      threads: [
        {
          id: HIST_LEAD,
          messages: [
            {
              from: HIST_LEAD,
              id: "wamid.e2e.hist.in.2",
              timestamp: tsNew,
              text: "mensaje reciente del historial",
            },
          ],
        },
      ],
    }),
  });
  ok("reproceso history entregado", histDup.res.ok);

  const histPlaceholder = await api("/api/dev/wa-mock/history", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      displayPhoneNumber: HIST_BIZ,
      threads: [
        {
          id: HIST_LEAD,
          messages: [
            {
              from: HIST_LEAD,
              id: "wamid.e2e.hist.media",
              timestamp: tsMid + 10,
              type: "media_placeholder",
            },
          ],
        },
      ],
    }),
  });
  ok("placeholder de media entregado", histPlaceholder.res.ok);
  await sleep(800);

  const histMedia = await api("/api/dev/wa-mock/history", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      displayPhoneNumber: HIST_BIZ,
      threads: [
        {
          id: HIST_LEAD,
          messages: [
            {
              from: HIST_LEAD,
              id: "wamid.e2e.hist.media",
              timestamp: tsMid + 10,
              type: "image",
              mediaId: "media-e2e-hist",
              caption: "foto del historial",
            },
          ],
        },
      ],
    }),
  });
  ok("follow-up de media (mismo wamid) entregado", histMedia.res.ok);
  await sleep(1600);

  const histConvs = (await api("/api/conversations")).json?.conversations ?? [];
  const histConv = histConvs.find((c) => c.contact.phone === "524627009001");
  ok("conversación histórica visible", Boolean(histConv), "sin conversación 524627009001");
  ok(
    "historial no marca no leídos",
    histConv?.unreadCount === 0,
    `unread=${histConv?.unreadCount}`
  );
  ok(
    "historial no pausa la IA",
    histConv?.aiEnabled === true && !histConv?.handoffReason,
    JSON.stringify({ aiEnabled: histConv?.aiEnabled, reason: histConv?.handoffReason })
  );

  const histMsgs =
    (await api(`/api/conversations/${histConv?.id}/messages`)).json?.messages ?? [];
  const histTexts = histMsgs.map((m) => m.text).filter(Boolean);
  ok(
    "no duplica el mensaje reprocesado",
    histTexts.filter((t) => t === "mensaje reciente del historial").length === 1,
    JSON.stringify(histTexts)
  );
  const idxOld = histMsgs.findIndex((m) => m.text === "mensaje más viejo");
  const idxMid = histMsgs.findIndex((m) => m.text === "respuesta vieja del negocio");
  const idxNew = histMsgs.findIndex((m) => m.text === "mensaje reciente del historial");
  ok(
    "mensajes ordenados por fecha histórica",
    idxOld !== -1 && idxMid !== -1 && idxNew !== -1 && idxOld < idxMid && idxMid < idxNew,
    JSON.stringify(histMsgs.map((m) => ({ text: m.text, at: m.createdAt, origin: m.origin, dir: m.direction })))
  );
  const histOut = histMsgs.find((m) => m.text === "respuesta vieja del negocio");
  ok(
    "saliente histórico es origin=manual y no dispara handoff",
    histOut?.direction === "out" && histOut?.origin === "manual"
  );
  const histMediaMsg = histMsgs.find((m) => m.media?.caption === "foto del historial");
  ok(
    "placeholder de media se enriqueció con el mismo wamid",
    histMediaMsg?.type === "image" && Boolean(histMediaMsg?.media),
    JSON.stringify(histMediaMsg)
  );

  const board = await api("/api/pipeline/board");
  const histLeadOnBoard = (board.json?.leads ?? []).some(
    (l) => l.contact?.phone === "524627009001"
  );
  ok("importar historial no crea leads", !histLeadOnBoard);

  const agendaPhone = "5214627009111";
  const syncAdd = await api("/api/dev/wa-mock/state-sync", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      contacts: [
        { action: "add", phone_number: agendaPhone, full_name: "Agenda Histórica" },
      ],
    }),
  });
  ok("state-sync add entregado", syncAdd.res.ok, JSON.stringify(syncAdd.json));
  await sleep(800);
  const contactsAdd = (await api("/api/contacts?q=Agenda")).json?.contacts ?? [];
  const agenda = contactsAdd.find((c) => c.phone === "524627009111" || c.name === "Agenda Histórica");
  ok("state-sync add crea contacto", Boolean(agenda), JSON.stringify(contactsAdd.map((c) => c.name)));

  const syncRm = await api("/api/dev/wa-mock/state-sync", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      contacts: [{ action: "remove", phone_number: agendaPhone }],
    }),
  });
  ok("state-sync remove entregado", syncRm.res.ok);
  await sleep(500);
  const contactsAfterRm = (await api("/api/contacts?q=Agenda")).json?.contacts ?? [];
  ok(
    "state-sync remove NO borra el contacto",
    contactsAfterRm.some((c) => c.id === agenda?.id || c.name === "Agenda Histórica")
  );

  console.log("\n== us-notificaciones: SSE enriquecido + multi-org ==");
  const notifText = `notif-e2e-in-${Date.now()}`;
  const sseIn = await collectSse(
    (ev) =>
      ev.type === "message.new" &&
      ev.data?.direction === "in" &&
      ev.data?.preview === notifText,
    {
      trigger: async () => {
        await api("/api/dev/wa-mock/inbound", {
          method: "POST",
          body: JSON.stringify({
            phoneNumberId: PN,
            from: "5215550001111",
            name: "Cliente Notif",
            text: notifText,
            waMessageId: `wamid.notif.in.${Date.now()}`,
          }),
        });
      },
    }
  );
  const inData = sseIn.match?.data;
  ok("SSE /api/events abre autenticado", sseIn.status === 200);
  ok(
    "inbound entrega message.new enriquecido (org, contacto, preview, messageId)",
    inData?.direction === "in" &&
      typeof inData?.organizationId === "string" &&
      inData.organizationId.length > 0 &&
      typeof inData?.organizationName === "string" &&
      typeof inData?.contactName === "string" &&
      inData.contactName.length > 0 &&
      inData.preview === notifText &&
      typeof inData?.messageId === "string" &&
      inData.message?.id === inData.messageId &&
      inData.message?.direction === "in",
    JSON.stringify(inData)
  );

  await sleep(400);
  const notifConvs = (await api("/api/conversations")).json?.conversations ?? [];
  const notifConv = notifConvs.find((c) => c.contact?.name === "Cliente Notif");
  ok("conversación del inbound de notificación existe", Boolean(notifConv));

  const outText = `notif-e2e-out-${Date.now()}`;
  const sseOut = await collectSse(
    (ev) =>
      ev.type === "message.new" &&
      ev.data?.direction === "out" &&
      ev.data?.preview === outText,
    {
      trigger: async () => {
        if (!notifConv?.id) return;
        await api(`/api/conversations/${notifConv.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ text: outText }),
        });
      },
    }
  );
  ok(
    "outbound llega por SSE con direction=out (no se notifica en cliente)",
    sseOut.match?.data?.direction === "out" &&
      sseOut.match?.data?.preview === outText,
    JSON.stringify(sseOut.match?.data)
  );

  const listed = await api("/api/auth/organization/list");
  let orgs = orgListFrom(listed.json);
  const orgA = orgs[0];
  let orgB = orgs.find((o) => o.slug === "espacio-veloz-e2e" || o.name === "Espacio Veloz E2E");
  if (!orgB) {
    const created = await api("/api/auth/organization/create", {
      method: "POST",
      body: JSON.stringify({
        name: "Espacio Veloz E2E",
        slug: "espacio-veloz-e2e",
      }),
    });
    orgB = created.json?.id
      ? { id: created.json.id, name: created.json.name, slug: created.json.slug }
      : created.json?.data
        ? created.json.data
        : null;
    if (!orgB?.id) {
      const listed2 = await api("/api/auth/organization/list");
      orgs = orgListFrom(listed2.json);
      orgB = orgs.find((o) => o.slug === "espacio-veloz-e2e");
    }
  }
  ok(
    "segunda organización disponible o creada",
    Boolean(orgA?.id && orgB?.id && orgA.id !== orgB.id),
    JSON.stringify({ orgA, orgB, listed: listed.json })
  );

  if (orgA?.id && orgB?.id && orgA.id !== orgB.id) {
    const setB = await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgB.id }),
    });
    ok("setActive → org B", setB.res.ok, JSON.stringify(setB.json));
    const connB = await api("/api/settings/whatsapp", {
      method: "PUT",
      body: JSON.stringify({
        wabaId: "WABA-E2E-B",
        phoneNumberId: PN_B,
        token: "tok-e2e-b",
      }),
    });
    ok("WhatsApp de org B conectado (mock)", connB.res.ok, JSON.stringify(connB.json));
    const setA = await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgA.id }),
    });
    ok("setActive → org A (visible)", setA.res.ok, JSON.stringify(setA.json));

    const crossText = `notif-e2e-cross-${Date.now()}`;
    const sseCross = await collectSse(
      (ev) =>
        ev.type === "message.new" &&
        ev.data?.direction === "in" &&
        ev.data?.preview === crossText,
      {
        trigger: async () => {
          await api("/api/dev/wa-mock/inbound", {
            method: "POST",
            body: JSON.stringify({
              phoneNumberId: PN_B,
              from: "5215550002222",
              name: "Cliente Org B",
              text: crossText,
              waMessageId: `wamid.notif.cross.${Date.now()}`,
            }),
          });
        },
      }
    );
    ok(
      "viendo org A, inbound de org B llega por SSE",
      sseCross.match?.data?.direction === "in" &&
        sseCross.match?.data?.organizationId === orgB.id &&
        sseCross.match?.data?.preview === crossText &&
        sseCross.match?.data?.contactName === "Cliente Org B",
      JSON.stringify(sseCross.match?.data)
    );

    const crossOut = `notif-e2e-cross-out-${Date.now()}`;
    const setB2 = await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgB.id }),
    });
    const convsB = setB2.res.ok
      ? ((await api("/api/conversations")).json?.conversations ?? [])
      : [];
    const convB = convsB.find((c) => c.contact?.name === "Cliente Org B");
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgA.id }),
    });
    const sseCrossOut = await collectSse(
      (ev) =>
        ev.type === "message.new" &&
        ev.data?.direction === "out" &&
        ev.data?.preview === crossOut,
      {
        trigger: async () => {
          if (!convB?.id) return;
          await api("/api/auth/organization/set-active", {
            method: "POST",
            body: JSON.stringify({ organizationId: orgB.id }),
          });
          await api(`/api/conversations/${convB.id}/messages`, {
            method: "POST",
            body: JSON.stringify({ text: crossOut }),
          });
          await api("/api/auth/organization/set-active", {
            method: "POST",
            body: JSON.stringify({ organizationId: orgA.id }),
          });
        },
      }
    );
    ok(
      "outbound de org B es direction=out (no notificar)",
      sseCrossOut.match?.data?.direction === "out",
      JSON.stringify({ convB: convB?.id, data: sseCrossOut.match?.data })
    );
  }

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});
