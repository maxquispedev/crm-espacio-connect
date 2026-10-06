/** 019 / sección 030: app real, BD dedicada, Playwright download + tenant/PII. */
export async function runCommercialExportSelftest({ BASE, api, ok, getCookie }) {
  const dbUrl = process.env.DATABASE_URL;
  const local = url => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  if (!dbUrl || !local(BASE) || !local(dbUrl) ||
      !/^commercial_export_test(_|$)/.test(new URL(dbUrl).pathname.slice(1)) ||
      process.env.WA_MOCK_ENABLED !== "true" || process.env.NODE_ENV === "production") {
    throw new Error("030 requiere app/BD locales dedicadas commercial_export_test y mocks de desarrollo");
  }
  const { default: postgres } = await import("postgres");
  const { chromium } = await import("playwright");
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const stamp = String(Date.now());
  const orgs = [];
  let browser;
  const previousOrg = (await api("/api/auth/get-session")).json?.session?.activeOrganizationId;
  const input = { date_from: "2026-10-06", date_to: "2026-10-06" };
  const exportApi = body => api("/api/commercial-export", { method: "POST", body: JSON.stringify(body) });
  try {
    const login = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({
      email: `export-${stamp}@vocero.test`, password: "password-e2e-123", name: "Export E2E" }) });
    if (!login.res.ok) throw new Error("030 no pudo autenticar fixture");
    ok("030 usuario autenticado", login.res.ok);
    for (const letter of ["A", "B"]) {
      const created = await api("/api/auth/organization/create", { method: "POST", body: JSON.stringify({
        name: `Export ${letter}`, slug: `export-${letter.toLowerCase()}-${stamp}` }) });
      if (!created.json?.id) throw new Error("030 no pudo crear organización");
      orgs.push(created.json.id);
    }
    const [orgA, orgB] = orgs;
    await api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId: orgA }) });
    const id = suffix => `${suffix}_030_${stamp}`;
    async function seed(org, suffix, createdAt, test = false) {
      await sql`insert into contact (id, organization_id, wa_identity, phone, wa_user_id, name)
        values (${id('ct_'+suffix)}, ${org}, ${'private-identity-'+suffix}, ${'private-phone-'+suffix}, ${'private-bsuid-'+suffix}, 'PRIVATE NAME')`;
      await sql`insert into conversation (id, organization_id, contact_id, is_test, ai_enabled, created_at)
        values (${id('cv_'+suffix)}, ${org}, ${id('ct_'+suffix)}, ${test}, false, ${createdAt.replace(' ', 'T') + 'Z'})`;
      return id('cv_'+suffix);
    }
    const cv = await seed(orgA, 'real', '2026-10-06 05:00:00');
    const organic = await seed(orgA, 'organic', '2026-10-07 04:59:59.999');
    const lab = await seed(orgA, 'lab', '2026-10-06 12:00:00', true);
    const other = await seed(orgB, 'other', '2026-10-06 12:00:00');
    const before = await seed(orgA, 'before', '2026-10-06 04:59:59.999');
    const after = await seed(orgA, 'after', '2026-10-07 05:00:00');
    const post = await seed(orgA, 'post', '2026-10-06 13:00:00');
    const stage = id('stage');
    await sql`insert into pipeline_stage (id, organization_id, name, position, kind)
      values (${stage}, ${orgA}, 'Interesado', 0, 'open')`;
    const snapshot = { snapshot: { token: 'PRIVATE TOKEN', waIdentity: 'private-identity' },
      decision: { nextAction: { type:'choice', choice:'present_price', confidence:.9, phone:'PRIVATE PHONE' },
        purchaseIntent: { type:'score', score:2.4 } }, plan:{lane:'auto_close', nextAction:'present_price', shouldHandoff:false} };
    await sql`insert into lead (id, organization_id, contact_id, stage_id, automation_lane, demo_shown_at,
      price_presented_at, payment_instructions_sent_at, human_requested_at, last_jev_evaluated_at, last_jev_decision,
      last_jev_playbook_version_id, last_jev_playbook_schema_version, follow_up_count, follow_up_reason)
      values (${id('ld')}, ${orgA}, ${id('ct_real')}, ${stage}, 'auto_close', '2026-10-06 12:00:00',
        '2026-10-06 12:01:00', '2026-10-06 12:02:00', '2026-10-06 12:03:00', '2026-10-06 12:00:00',
        ${sql.json(snapshot)}, 'pv_fixture', '1.0', 1, 'after_price')`;
    await sql`update conversation set handoff_at='2026-10-06 12:03:00', handoff_reason='commercial' where organization_id=${orgA} and id=${cv}`;
    for (const [org, conv, suffix, sourceType] of [[orgA,cv,'real','ad'], [orgB,other,'other','ad'], [orgA,post,'post','post']]) {
      await sql`insert into ad_attribution (id, organization_id, contact_id, conversation_id, source_id, source_type,
        headline, body, media_type, ctwa_clid, raw) values (${id('ad_'+suffix)}, ${org}, ${id('ct_'+suffix)}, ${conv},
        'shared-source', ${sourceType}, 'Anuncio fixture', 'Control comercial', 'video', 'PRIVATE CTWA', ${sql.json({token:'PRIVATE TOKEN'})})`;
    }
    await sql`insert into media_asset (id, organization_id, kind, mime_type, file_name, caption, storage_path, payload)
      values (${id('media')}, ${orgA}, 'video', 'video/mp4', '/internal/demo.mp4', 'Demo fixture', '/PRIVATE/PATH', ${sql.json({phone:'PRIVATE PHONE'})})`;
    const msgSpecs = [
      ['late','out','ai',true,'2026-10-08 10:00:00','Respuesta Jev'],
      ['in','in','operator',false,'2026-10-06 06:00:00','¿Cómo funciona?'],
      ['operator','out','operator',false,'2026-10-06 07:00:00','Respuesta operador'],
      ['manual','out','manual',false,'2026-10-06 08:00:00','Respuesta manual'],
      ['template','out','template',false,'2026-10-06 09:00:00','Plantilla'],
    ];
    for (const [suffix,direction,origin,ai,ts,text] of msgSpecs) {
      await sql`insert into message (id, organization_id, conversation_id, direction, origin, ai_generated,
        text, status, wa_timestamp, created_at, media_asset_id, wa_message_id)
        values (${id('m_'+suffix)}, ${orgA}, ${cv}, ${direction}, ${origin}, ${ai}, ${text}, 'sent', ${ts.replace(' ', 'T') + 'Z'},
        '2026-10-09 10:00:00', ${suffix==='late' ? id('media') : null}, ${'PRIVATE-WAMID-'+suffix+'-'+stamp})`;
    }
    // Corrupt legacy rows with cross-tenant single-column FKs must still be excluded.
    await sql`insert into message (id, organization_id, conversation_id, direction, text) values
      (${id('m_foreign')}, ${orgB}, ${cv}, 'in', 'FOREIGN CONTENT'),
      (${id('m_lab')}, ${orgA}, ${lab}, 'in', 'LAB CONTENT')`;
    await sql`insert into sales_follow_up_job (id, organization_id, lead_id, conversation_id, reason,
      attempt_number, due_at, anchor_at, status, message_id) values (${id('job')}, ${orgA}, ${id('ld')}, ${cv},
      'after_price', 1, '2026-10-08 10:00:00', '2026-10-06 07:00:00', 'sent', ${id('m_late')})`;
    await sql`insert into conversion_event (id, organization_id, conversation_id, event_name, status, custom_data, payload, fbtrace_id)
      values (${id('event')}, ${orgA}, ${cv}, 'Purchase', 'sent', ${sql.json({lead_stage:'won',value:247,currency:'PEN',phone:'PRIVATE PHONE'})},
        ${sql.json({token:'PRIVATE TOKEN'})}, 'PRIVATE TRACE')`;
    await sql`insert into sales_outbound_delivery (message_id, organization_id, conversation_id, lead_id, inbound_message_id,
      plan, demo_slot, payment_group_id, payment_part, payment_parts, follow_up_job_id, confirmed_at, failed_at, invalidated_at)
      values (${id('m_late')}, ${orgA}, ${cv}, ${id('ld')}, ${id('m_in')},
        ${sql.json({salesPlan:{nextAction:'present_price',lane:'auto_close',phone:'PRIVATE PHONE'},scheduleFollowUp:true,token:'PRIVATE TOKEN'})},
        'demo_enrollment_panel', 'payment-fixture', 1, 1, ${id('job')}, '2026-10-08 10:00:00', null, null)`;

    const browserContextCookies = getCookie().split(';').filter(Boolean).map(part => {
      const [name,...value] = part.trim().split('='); return {name,value:value.join('='),url:BASE};
    });
    browser = await chromium.launch({ headless:true });
    const context = await browser.newContext({ acceptDownloads:true });
    await context.addCookies(browserContextCookies);
    const page = await context.newPage();
    await page.goto(`${BASE}/inbox`);
    await page.getByRole('button',{name:'Exportar dataset comercial'}).click();
    await page.getByLabel('Desde',{exact:true}).fill(input.date_from);
    await page.getByLabel('Hasta',{exact:true}).fill(input.date_to);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button',{name:'Descargar JSON',exact:true}).click();
    const download = await downloaded;
    const stream = await download.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const data = JSON.parse(text);
    ok('030 descarga JSON versionado reconocible', data.schema_version==='1.0' && /^espacio-connect-commercial-export-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()));
    ok('030 organización activa', data.organization.id===orgA);
    ok('030 límites Lima inclusivos / test y tenant excluidos', data.conversations.length===3 &&
      data.conversations.some(c=>c.conversation_id===organic) && ![lab,other,before,after].some(id=>data.conversations.some(c=>c.conversation_id===id)),
      JSON.stringify(data.conversations.map(c=>({id:c.conversation_id,created:c.created_at}))));
    const conversation = data.conversations.find(c=>c.conversation_id===cv);
    ok('030 historial completo ordenado por timestamp aunque ingesta posterior', conversation.messages.map(m=>m.id).join(',')===['in','operator','manual','template','late'].map(s=>id('m_'+s)).join(','));
    ok('030 todas las señales comerciales', conversation.lead.lead_id===id('ld') && conversation.lead.stage.id===stage &&
      conversation.attribution.source_id==='shared-source' && conversation.jev.last_jev_decision.decision.nextAction.choice==='present_price' &&
      conversation.follow_ups[0].message_id===id('m_late') && conversation.outbound_deliveries[0].confirmed_at && conversation.commercial_events[0].custom_data.value===247);
    ok('030 summary exacto sin heurísticas', data.summary.messages===5 && data.summary.inbound_messages===1 &&
      data.summary.ai_messages===1 && data.summary.operator_messages===1 && data.summary.manual_messages===1 &&
      data.summary.template_messages===1 && data.summary.handoffs===1 && data.summary.payment_instructions_sent===1);
    ok('030 sin PII estructurada/raw/secretos/rutas ni filas extranjeras', !/private|foreign content|lab content|ctwa|waIdentity|waUserId|wa_identity|wa_user_id|"phone"|"raw"|"payload"|fbtrace|token|storage_path|\/internal\//i.test(text));
    ok('030 media solo metadata segura', conversation.messages.at(-1).media.file_name==='demo.mp4');
    const ads = await exportApi({...input,ad_attributed_only:true,source_ids:['shared-source']});
    ok('030 anuncios excluye post y fuente compartida no cruza tenant', ads.json?.conversations.length===1 && ads.json.conversations[0].conversation_id===cv);
    ok('030 source_id ajeno/desconocido vacío', (await exportApi({...input,source_ids:['unknown']})).json?.summary.conversations===0);
    ok('030 request no admite tenant ni IDs arbitrarios', (await exportApi({...input,organization_id:orgB})).res.status===422);
    const anonymous = await fetch(`${BASE}/api/commercial-export`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    ok('030 sin sesión 401', anonymous.status===401);
    await page.getByLabel('Desde',{exact:true}).fill('2026-10-07');
    await page.getByRole('button',{name:'Descargar JSON',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Desde debe ser anterior'}).waitFor();
    ok('030 rango invertido error legible recuperable', await page.getByRole('button',{name:'Descargar JSON',exact:true}).isEnabled());
    await page.getByLabel('Desde',{exact:true}).fill(input.date_from);
    await page.route('**/api/commercial-export', route=>route.abort());
    await page.getByRole('button',{name:'Descargar JSON',exact:true}).click();
    await page.locator('#commercial-export-form').getByRole('alert').waitFor();
    ok('030 fallo de red no deja loading colgado', await page.getByRole('button',{name:'Descargar JSON',exact:true}).isEnabled());
    await page.unroute('**/api/commercial-export');
    const retry = page.waitForEvent('download');
    await page.getByRole('button',{name:'Descargar JSON',exact:true}).click();
    await retry;
    ok('030 reintento descarga sin navegar', new URL(page.url()).pathname==='/inbox');
  } finally {
    await browser?.close();
    if (previousOrg) await api('/api/auth/organization/set-active',{method:'POST',body:JSON.stringify({organizationId:previousOrg})});
    for (const org of orgs) await sql`delete from organization where id=${org}`;
    await sql.end();
  }
}
