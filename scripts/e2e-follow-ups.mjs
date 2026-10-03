/**
 * E2E completo de follow-ups (A–E del arnés existente + guardrails).
 * Solo BD y app efímeras locales; nunca usar con datos reales.
 * App: WA_MOCK_ENABLED=true, Graph → /api/dev/wa-mock/graph,
 * Jev → http://localhost:3022/jev, writer → http://localhost:3022,
 * AGENT_COALESCE_MS=6000. Ejecutar con el mismo env de la app:
 * FOLLOW_UP_E2E=1 node --env-file=/tmp/app/.env scripts/e2e-follow-ups.mjs
 */
import http from 'node:http';
import postgres from 'postgres';

if (process.env.FOLLOW_UP_E2E !== '1' ||
    !['localhost','127.0.0.1'].includes(new URL(process.env.APP_BASE_URL).hostname) ||
    !['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error('Requiere FOLLOW_UP_E2E=1 y app/BD efímeras locales');
}
// Ejercita timestamp sin zona con proceso Node fuera de UTC.
process.env.TZ = 'America/Lima';
let writerFail = false;
let writerDelay = 0;
const answers = {real_operational_need:{type:'noul',noul:0.62},product_fit:{type:'score',score:2.4},motivation_to_change:{type:'score',score:1.8},purchase_intent:{type:'score',score:1.5},buying_timing:{type:'choice',choice:'unknown'},main_value_proposition:{type:'choice',choice:'operational_control'},next_action:{type:'choice',choice:'present_price'},needs_human_call:{type:'noul',noul:0.12}};
const provider = http.createServer(async (req,res) => {
  let body = "";
  for await (const chunk of req) { body += chunk; }
  res.setHeader('content-type','application/json');
  if(req.url === '/jev') {
    const payload = JSON.parse(body);
    const invalid = Object.entries(payload.questions).find(([, q]) =>
      q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.some(c => typeof c !== 'string')));
    if (invalid) {
      res.statusCode = 422;
      res.end(JSON.stringify({detail:[{loc:['body','questions',invalid[0],'score','criteria'],msg:'Input should be a valid list'}]}));
      return;
    }
    res.end(JSON.stringify({model:'local-jev',answers}));return;
  }
  if(writerDelay) await new Promise(resolve=>setTimeout(resolve,writerDelay));
  if(writerFail) {res.statusCode=503;res.end('{}');return;}
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'¿Retomamos lo que conversamos?'})}}]}));
});
await new Promise(resolve => provider.listen(3022,'127.0.0.1',resolve));

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PN = "PN-E2E-1";
const PN_B = "PN-E2E-2";
const FROM_FU = "521555019901";
const FROM_FU_E = "521555019902";

async function waitFor(fn, timeoutMs = 20000, intervalMs = 400) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

function orgListFrom(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.organizations)) return json.organizations;
  return [];
}

async function main() {
  const email = "follow-up-hotfix@vocero.test";
  const password = "password-e2e-123";
  let reg = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador follow-ups" }),
  });
  if (!reg.res.ok) {
    reg = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("follow-ups · signup/login operador", reg.res.ok, JSON.stringify(reg.json));
  const cookieA = cookie;

  // El registro NO crea organización (Better Auth organization plugin sin
  // `createOrganizationOnSignUp`): sin un tenant, `requireSession` responde
  // 401 y no hay contra qué sembrar. Reutilizamos la primera org del
  // usuario o creamos una propia.
  let orgsA = orgListFrom((await api("/api/auth/organization/list")).json);
  let orgA = orgsA[0];
  if (!orgA) {
    const createdOrg = await api("/api/auth/organization/create", {
      method: "POST",
      body: JSON.stringify({
        name: "Follow-ups E2E",
        slug: `follow-ups-e2e-${Date.now()}`,
      }),
    });
    orgA = createdOrg.json?.id
      ? { id: createdOrg.json.id }
      : orgListFrom((await api("/api/auth/organization/list")).json)[0];
  }
  ok("follow-ups · organización del operador", !!orgA?.id, JSON.stringify(orgA));
  if (orgA?.id) {
    await api("/api/auth/organization/set-active", {
      method: "POST",
      body: JSON.stringify({ organizationId: orgA.id }),
    });
  }


  // Fixture exclusivamente de esta BD local efímera.

  const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
  await sql`delete from contact where organization_id=${orgA.id}`;
  await sql`insert into agent_profile (id, organization_id, enabled, sales_orchestrator_enabled, sales_follow_ups_enabled)
    values ('ap_launch', ${orgA.id}, true, true, true) on conflict (organization_id) do nothing`;
  for (const [id, name, kind, pos] of [['st_launch_new','Nuevo','open',0],['st_launch_chat','En conversación','open',1],['st_launch_int','Interesado','open',2],['st_launch_lost','Perdido','lost',3]]) {
    await sql`insert into pipeline_stage (id,organization_id,name,kind,position) values (${id},${orgA.id},${name},${kind},${pos}) on conflict do nothing`;
  }
  const conn = await api('/api/settings/whatsapp', {method:'PUT', body:JSON.stringify({wabaId:'WABA-E2E',phoneNumberId:PN,token:'tok-e2e'})});
  ok('WhatsApp mock conectado', conn.res.ok);

  console.log("\n== sales-follow-ups: motor automático (mocks) ==");
  const fuFlags = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({
      enabled: true,
      salesOrchestratorEnabled: true,
      salesFollowUpsEnabled: true,
    }),
  });
  ok(
    "flags Orchestrator + follow-ups ON",
    fuFlags.res.ok,
    JSON.stringify(fuFlags.json)
  );
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  const inFu = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: FROM_FU,
      name: "Lead Follow-up",
      text: "hola, quiero información",
      waMessageId: "wamid.hotfix.repro.fu.a1",
    }),
  });
  ok("A inbound entregado", inFu.res.ok, JSON.stringify(inFu.json));

  const fuConv = await waitFor(async () => {
    const list = (await api("/api/conversations")).json?.conversations ?? [];
    return list.find((c) => c.contact?.name === "Lead Follow-up") ?? null;
  });
  ok("A conversación creada", Boolean(fuConv), JSON.stringify(fuConv));

  const fuAgentOut = await waitFor(async () => {
    if (!fuConv?.id) return null;
    const msgs =
      (await api(`/api/conversations/${fuConv.id}/messages`)).json?.messages ??
      [];
    return msgs.find((m) => m.direction === "out") ?? null;
  }, 25000);
  ok("A el agente respondió", Boolean(fuAgentOut), JSON.stringify(fuAgentOut));

  const fuContactId = fuConv?.contact?.id;
  const fuDetail = fuContactId
    ? await api(`/api/contacts/${fuContactId}`)
    : { json: null };
  const fuLeadId = fuDetail.json?.lead?.id;
  const fuSales = fuDetail.json?.lead?.sales;
  ok(
    "A job de follow-up creado (nextFollowUpAt)",
    Boolean(fuSales?.nextFollowUpAt),
    JSON.stringify(fuSales)
  );
  ok(
    "A DTO no filtra secretos",
    !JSON.stringify(fuDetail.json ?? {}).toLowerCase().includes("bearer") &&
      !JSON.stringify(fuDetail.json ?? {}).includes("sk-"),
    JSON.stringify(fuDetail.json?.lead)
  );

  const outBeforeB =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const runB = await api("/api/dev/follow-ups/run", {
    method: "POST",
    body: JSON.stringify({ expire: true, leadId: fuLeadId }),
  });
  ok("B tick expire ejecutado", runB.res.ok, JSON.stringify(runB.json));
  const fuOutB = await waitFor(async () => {
    if (!fuConv?.id) return null;
    const msgs =
      (await api(`/api/conversations/${fuConv.id}/messages`)).json?.messages ??
      [];
    const outs = msgs.filter((m) => m.direction === "out");
    return outs.length >= 2 ? outs : null;
  }, 15000);
  ok(
    "B follow-up observable en el hilo",
    Boolean(fuOutB),
    fuOutB ? `outs=${fuOutB.length}` : "sin segundo outbound"
  );
  const outAfterB =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "B Graph mock recibió el follow-up (no Meta real)",
    outAfterB === outBeforeB + 1,
    `${outBeforeB} → ${outAfterB}`
  );

  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: FROM_FU,
      name: "Lead Follow-up",
      text: "sigo aquí",
      waMessageId: "wamid.hotfix.repro.fu.c1",
    }),
  });
  await sleep(400);
  const afterInbound = fuContactId
    ? await api(`/api/contacts/${fuContactId}`)
    : { json: null };
  ok(
    "C inbound cancela pending (nextFollowUpAt null)",
    afterInbound.json?.lead?.sales?.nextFollowUpAt === null,
    JSON.stringify(afterInbound.json?.lead?.sales)
  );

  const cancelledInbound = await sql`select id from sales_follow_up_job
    where organization_id=${orgA.id} and lead_id=${fuLeadId} and status='cancelled' and error='inbound_message'`;
  ok('C job siguiente cancelado durablemente por inbound', cancelledInbound.length > 0);

  const fuAgentOut2 = await waitFor(async () => {
    if (!fuConv?.id) return null;
    const detail = await api(`/api/contacts/${fuContactId}`);
    return detail.json?.lead?.sales?.nextFollowUpAt ? detail.json : null;
  }, 25000);
  ok(
    "D nueva secuencia tras respuesta del agente",
    Boolean(fuAgentOut2?.lead?.sales?.nextFollowUpAt),
    JSON.stringify(fuAgentOut2?.lead?.sales)
  );

  for (let i = 0; i < 3; i++) {
    const tick = await api("/api/dev/follow-ups/run", {
      method: "POST",
      body: JSON.stringify({ expire: true, leadId: fuLeadId }),
    });
    ok(`D tick ${i + 1}/3`, tick.res.ok, JSON.stringify(tick.json));
    await sleep(300);
  }
  const afterD = fuContactId
    ? await api(`/api/contacts/${fuContactId}`)
    : { json: null };
  const salesD = afterD.json?.lead?.sales;
  ok(
    "D tercer intento → Dormido (stop + no_reply_exhausted)",
    salesD?.lane === "stop" && salesD?.followUpReason === "no_reply_exhausted",
    JSON.stringify(salesD)
  );
  ok(
    "D pipeline no pasó a lost",
    afterD.json?.stage?.kind !== "lost",
    JSON.stringify(afterD.json?.stage)
  );
  // `board` ya está declarado más arriba en este mismo scope (sección de
  // follow-ups): aquí usamos un nombre propio para no chocar.
  const boardFollowUps = await api("/api/pipeline/board");
  const boardLead = (boardFollowUps.json?.leads ?? []).find(
    (l) => l.id === fuLeadId
  );
  ok(
    "D board no dice Perdido por silencio",
    boardLead?.automationLane === "stop" &&
      boardLead?.followUpReason === "no_reply_exhausted",
    JSON.stringify(boardLead)
  );

  const attempts = await sql`select attempt_number from sales_follow_up_job
    where organization_id=${orgA.id} and lead_id=${fuLeadId} and status='sent' order by created_at desc limit 3`;
  ok('D tres intentos comerciales enviados, sin duplicados',
    attempts.map(j=>j.attempt_number).sort().join(',')==='1,2,3');

  const inE = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: FROM_FU_E,
      name: "Lead Ventana Cerrada",
      text: "hola desde otra línea",
      waMessageId: "wamid.hotfix.repro.fu.e1",
    }),
  });
  ok("E inbound ventana-cerrada entregado", inE.res.ok, JSON.stringify(inE.json));
  const eConv = await waitFor(async () => {
    const list = (await api("/api/conversations")).json?.conversations ?? [];
    return list.find((c) => c.contact?.name === "Lead Ventana Cerrada") ?? null;
  });
  await waitFor(async () => {
    if (!eConv?.contact?.id) return null;
    const d = await api(`/api/contacts/${eConv.contact.id}`);
    return d.json?.lead?.sales?.nextFollowUpAt ? d.json : null;
  }, 25000);
  const eDetail = eConv?.contact?.id
    ? await api(`/api/contacts/${eConv.contact.id}`)
    : { json: null };
  const eLeadId = eDetail.json?.lead?.id;
  const outBeforeE =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const runE = await api("/api/dev/follow-ups/run", {
    method: "POST",
    body: JSON.stringify({
      expire: true,
      closeWindow: true,
      leadId: eLeadId,
    }),
  });
  ok("E tick con ventana cerrada", runE.res.ok, JSON.stringify(runE.json));
  await sleep(800);
  const afterE = eConv?.contact?.id
    ? await api(`/api/contacts/${eConv.contact.id}`)
    : { json: null };
  ok(
    "E blocked template_required",
    afterE.json?.lead?.sales?.followUpReason === "template_required",
    JSON.stringify(afterE.json?.lead?.sales)
  );
  const outAfterE =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "E no envió texto libre por Graph",
    outAfterE === outBeforeE,
    `${outBeforeE} → ${outAfterE}`
  );

  const blocked = await sql`select id from sales_follow_up_job
    where organization_id=${orgA.id} and lead_id=${eLeadId} and status='blocked' and error='template_required'`;
  ok('E job blocked/template_required durable', blocked.length === 1);

  console.log('\n== follow-ups: guardrails PostgreSQL real ==');
  const ctx = { org: orgA.id, lead: fuLeadId, conv: fuConv.id };
  let sequence = 0;
  async function seedJob(c = ctx, opts = {}) {
    await sql`update sales_follow_up_job set status='cancelled',claimed_at=null
      where organization_id=${c.org} and lead_id=${c.lead} and status in ('pending','processing')`;
    const due = new Date(Date.now() - 2000).toISOString();
    const id = `sfj_guard_${Date.now()}_${sequence++}`;
    await sql`update lead set automation_lane=${opts.lane ?? 'auto'},follow_up_count=0,
      next_follow_up_at=${due}::timestamp,follow_up_reason='awaiting_reply'
      where organization_id=${c.org} and id=${c.lead}`;
    await sql`update conversation set ai_enabled=true,handoff_at=${opts.handoff ? due : null}::timestamp,
      last_inbound_at=${new Date().toISOString()}::timestamp where organization_id=${c.org} and id=${c.conv}`;
    await sql`update agent_profile set enabled=true,sales_orchestrator_enabled=true,
      sales_follow_ups_enabled=${opts.enabled ?? true} where organization_id=${c.org}`;
    await sql`insert into sales_follow_up_job
      (id,organization_id,lead_id,conversation_id,reason,attempt_number,due_at,anchor_at,status,claimed_at)
      values (${id},${c.org},${c.lead},${c.conv},'awaiting_reply',1,${due}::timestamp,
      (select greatest(coalesce(max(greatest(created_at,wa_timestamp)),CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 millisecond'
        from message where organization_id=${c.org} and conversation_id=${c.conv}),
      ${opts.status ?? 'pending'},${opts.claimedAt ?? null}::timestamp)`;
    return id;
  }
  const job = async (id) => (await sql`select * from sales_follow_up_job where id=${id}`)[0];
  const outCount = async () => ((await api('/api/dev/wa-mock/outbox')).json?.outbox ?? []).length;
  const tick = () => api('/api/dev/follow-ups/run', {method:'POST',body:JSON.stringify({expire:false})});
  const before = await outCount();
  const concurrentId = await seedJob();
  writerDelay = 500;
  const ticks = Promise.all([tick(), tick()]);
  const owned = await waitFor(async () => {
    const rows = await sql`select claimed_at AT TIME ZONE 'UTC' as claimed_at,
      due_at AT TIME ZONE 'UTC' as due_at,anchor_at AT TIME ZONE 'UTC' as anchor_at,
      created_at AT TIME ZONE 'UTC' as created_at,updated_at AT TIME ZONE 'UTC' as updated_at,
      extract(microseconds from claimed_at)::bigint % 1000 as remainder
      from sales_follow_up_job where id=${concurrentId} and status='processing'`;
    return rows[0];
  },5000,20);
  ok('RETURNING UTC: todas las fechas son Date válidas y lease en milisegundos',
    owned && ['claimed_at','due_at','anchor_at','created_at','updated_at'].every(k =>
      owned[k] instanceof Date && Number.isFinite(owned[k].getTime())) && Number(owned.remainder)===0);
  const concurrent = await ticks;
  writerDelay = 0;
  ok('dos ticks concurrentes → un solo envío y job sent',
    concurrent.every(r=>r.res.ok) && (await outCount())===before+1 && (await job(concurrentId)).status==='sent');
  await tick();
  ok('tick repetido no duplica envío', (await outCount())===before+1);

  const retryId = await seedJob();
  writerFail = true;
  const retryBefore = await outCount();
  await tick();
  const retry = await job(retryId);
  const retryLead = (await sql`select follow_up_count,next_follow_up_at::text as due from lead
    where organization_id=${ctx.org} and id=${ctx.lead}`)[0];
  const retryDue = (await sql`select due_at::text as due from sales_follow_up_job where id=${retryId}`)[0].due;
  ok('retry técnico no consume intento comercial ni envía', retry.status==='pending' && retry.run_attempts===1 &&
    retry.attempt_number===1 && retryLead.follow_up_count===0 && retryLead.due===retryDue && (await outCount())===retryBefore);
  writerFail = false;
  await api('/api/dev/follow-ups/run',{method:'POST',body:JSON.stringify({expire:true,leadId:ctx.lead})});
  ok('retry entrega el mismo job una sola vez', (await job(retryId)).status==='sent' &&
    (await job(retryId)).attempt_number===1 && (await outCount())===retryBefore+1);

  const staleId = await seedJob(ctx,{status:'processing',claimedAt:new Date(Date.now()-11*60*1000).toISOString()});
  const leaseBefore = await outCount();
  await tick();
  ok('lease abandonado se recupera y envía una sola vez', (await job(staleId)).status==='sent' && (await outCount())===leaseBefore+1);
  const freshId = await seedJob(ctx,{status:'processing',claimedAt:new Date().toISOString()});
  await tick();
  ok('lease vigente no se roba', (await job(freshId)).status==='processing' && (await outCount())===leaseBefore+1);

  for (const [label,opts,error] of [
    ['HUMAN',{lane:'human'},'lane_human'],['STOP',{lane:'stop'},'lane_stop'],
    ['handoff',{handoff:true},'handoff_active'],['follow-ups OFF',{enabled:false},'follow_ups_disabled']
  ]) {
    const id=await seedJob(ctx,opts);const count=await outCount();await tick();const row=await job(id);
    ok(`${label} cancela y no envía`,row.status==='cancelled' && row.error===error && (await outCount())===count);
  }

  const orgB = `org_fu_${Date.now()}`;
  await sql`insert into organization(id,name,slug,created_at) values (${orgB},'Follow-up tenant B',${orgB},CURRENT_TIMESTAMP)`;
  await sql`insert into agent_profile(id,organization_id,enabled,sales_orchestrator_enabled,sales_follow_ups_enabled)
    values (${`ap_${orgB}`},${orgB},true,true,true)`;
  await sql`insert into pipeline_stage(id,organization_id,name,position) values (${`st_${orgB}`},${orgB},'Nuevo',0)`;
  await sql`insert into contact(id,organization_id,wa_identity,name) values (${`ct_${orgB}`},${orgB},'521555019903','Tenant B')`;
  await sql`insert into lead(id,organization_id,contact_id,stage_id)
    values (${`ld_${orgB}`},${orgB},${`ct_${orgB}`},${`st_${orgB}`})`;
  await sql`insert into conversation(id,organization_id,contact_id,is_test)
    values (${`cv_${orgB}`},${orgB},${`ct_${orgB}`},true)`;
  const bCtx={org:orgB,lead:`ld_${orgB}`,conv:`cv_${orgB}`};
  const aId=await seedJob();const bId=await seedJob(bCtx);
  const tenantBefore=await outCount();await tick();
  const aMessage=(await sql`select m.organization_id from message m inner join sales_follow_up_job j
    on j.message_id=m.id where j.id=${aId}`)[0];
  const bMessage=(await sql`select m.organization_id from message m inner join sales_follow_up_job j
    on j.message_id=m.id where j.id=${bId}`)[0];
  ok('dos tenants: mensajes persistidos en su org, sandbox B sin Graph',
    (await job(aId)).status==='sent' && (await job(bId)).status==='sent' &&
    aMessage?.organization_id===ctx.org && bMessage?.organization_id===orgB && (await outCount())===tenantBefore+1);
  const malformed=await seedJob(bCtx);
  await sql`update sales_follow_up_job set lead_id=${ctx.lead},conversation_id=${ctx.conv} where id=${malformed} and organization_id=${orgB}`;
  const leadBefore=JSON.stringify(await sql`select * from lead where organization_id=${ctx.org} and id=${ctx.lead}`);
  const malformedBefore=await outCount();await tick();
  ok('job cross-tenant se cancela sin tocar lead ajeno ni enviar', (await job(malformed)).status==='cancelled' &&
    (await job(malformed)).error==='context_missing' && (await outCount())===malformedBefore &&
    JSON.stringify(await sql`select * from lead where organization_id=${ctx.org} and id=${ctx.lead}`)===leadBefore);
  await sql`delete from organization where id=${orgB}`;

  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({
      salesFollowUpsEnabled: false,
      salesOrchestratorEnabled: false,
    }),
  });


  await sql.end();
  console.log(`${checks-failures}/${checks} checks OK`);
  await new Promise(resolve => provider.close(resolve));
  process.exit(failures ? 1 : 0);
}
main().catch(err=>{console.error(err);process.exit(1);});
