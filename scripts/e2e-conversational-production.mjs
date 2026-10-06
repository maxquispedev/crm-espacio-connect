/** 020 / sección 031: reutiliza app/PG/webhook/sender/mocks de 021, sin Graph real. */
export async function runConversationalProductionCases({ api, sql, org, send, ok, setAction, setWriter, getWriterCalls }) {
  const latestText = request => request.messages?.find(m => m.role === 'user')?.content ?? '';
  const leadState = async label => (await sql`SELECT l.*, cv.handoff_at, cv.ai_enabled, cv.id AS conversation_id FROM lead l
    JOIN contact ct ON ct.id=l.contact_id AND ct.organization_id=l.organization_id
    JOIN conversation cv ON cv.contact_id=ct.id AND cv.organization_id=ct.organization_id
    WHERE l.organization_id=${org} AND ct.name=${label}`)[0];
  const priorQuestion = '¿Qué se te desordena más: alumnos, pagos, horarios o saldos?';
  const caption = 'Aquí puedes ver cómo organizar toda la operación de tu academia.';
  const price = 'El sistema cuesta S/247 al mes hasta 50 alumnos activos. Para empezar haces el pago de S/247 y con eso iniciamos la implementación contigo; ese pago ya incluye tus primeros 30 días y el acompañamiento para dejar todo funcionando. Desde el alumno 51 se suma S/1 por cada alumno activo adicional. No hay permanencia obligatoria.';
  const referral = headline => ({ source_type:'ad', source_id:'fixture-031', headline, body:'Alumnos, pagos y horarios en orden' });
  setAction('ask_more_questions');
  for (const [label, headline, pattern] of [
    ['031-A','Controla pagos y saldos pendientes',/quién pagó.*cuánto pagó.*cuánto falta cobrar/],
    ['031-B','Prepárate antes del verano',/verano.*temporada alta/],
    ['031-C','Ten tu academia bajo control',/operación.*Excel, papel y WhatsApp/],
    ['031-D','Toda tu academia, en un solo lugar',/alumnos, apoderados, planes y horarios/],
  ]) {
    const r = await send(label,'¡Hola! Quiero más información',{referral:referral(headline)});
    const text = r.messages[0]?.text ?? '';
    ok(`${label} opener específico, UNA pregunta, cero video/fact/dolor supuesto`, r.messages.length===1 && r.messages[0].type==='text' && pattern.test(text) &&
      (text.match(/\?/g)??[]).length===1 && text.length<260 && !r.fact && r.outbox.length===1 && !/tienes deudas|tus morosos/i.test(text));
    if (label==='031-A') {
      const advanced = 'También puedes ver el historial de pagos y consultar el saldo de cada alumno desde el mismo lugar.';
      setWriter(request => {
        ok('031-E retry contiene rechazo y pide avanzar sin repetir pregunta', JSON.stringify(request).includes('ya fue enviada') && JSON.stringify(request).includes('No repitas la misma pregunta'));
        return advanced;
      });
      const retry = await send(label,'Más información',{phone:r.phone});
      ok('031-E primer opener duplicado no sale; único retry avanza', retry.messages.length===1 && retry.messages[0].text===advanced && retry.messages[0].text!==text && getWriterCalls().length===1 && retry.outbox.length===1);
      setWriter(() => advanced);
      const silent = await send(label,'Más información',{phone:r.phone,expectedSilence:true});
      const state = await leadState(label);
      ok('031-E unhappy opener fijo + único retry Writer, cero outbound duplicado, IA operable', getWriterCalls().length===1 && silent.outbox.length===0 &&
        state.last_jev_decision.plan.replyGuardReason==='duplicate_retry_exhausted' && state.last_jev_decision.plan.shouldReply===false && !state.handoff_at && state.ai_enabled);
      const jobs = await sql`SELECT id FROM sales_follow_up_job WHERE organization_id=${org} AND conversation_id=${state.conversation_id} AND status='pending'`;
      ok('031-E silencio no inventa facts/jobs', !state.demo_shown_at && !state.price_presented_at && jobs.length===0);
      setWriter(()=>'Puedes registrar pagos completos o parciales y consultar los saldos pendientes.');
      const resumed = await send(label,'Qué más incluye?',{phone:r.phone});
      ok('031-E siguiente inbound sigue siendo atendible', resumed.messages.length===1 && resumed.outbox.length===1 && !(await leadState(label)).handoff_at);
    }
  }
  // Fixture reproduce bug exacto: al primer Todos se corta, no llega a segunda priorización.
  setWriter(()=>priorQuestion);
  const excel = await send('031-FG','Con excel');
  ok('031-FG Excel recibe pregunta útil', excel.messages[0]?.text===priorQuestion && !excel.fact);
  setWriter(()=>caption);
  const all = await send('031-FG','Todos',{phone:excel.phone});
  ok('031-FG primer Todos avanza demo general sin repregunta', all.messages.length===1 && all.messages[0].type==='video' && all.messages[0].file_name==='demo_enrollment_panel.mp4' && all.messages[0].caption===caption);
  ok('031-FG snapshot conserva propuesta, acción efectiva y reason', all.decision?.decision?.nextAction?.choice==='ask_more_questions' &&
    all.decision?.plan?.nextAction==='show_operations_demo' && all.decision?.plan?.questionLoopGuardReason==='broad_operational_need' && !!all.fact);
  setWriter(()=>'Puedes organizar alumnos, pagos y horarios desde el panel que te mostré.');
  const allAgain = await send('031-FG','Todos',{phone:excel.phone});
  const videos = await sql`SELECT id FROM message WHERE organization_id=${org} AND conversation_id=${(await leadState('031-FG')).conversation_id} AND direction='out' AND type='video'`;
  ok('031-G segundo Todos no repite demo ni pregunta de priorización', videos.length===1 && allAgain.messages[0]?.type==='text' && !allAgain.messages[0]?.text?.includes('?'));

  setWriter(()=>priorQuestion);
  const good = await send('031-H','Con excel');
  setAction('show_operations_demo'); setWriter(()=>'Aquí puedes ver el control de pagos y saldos.');
  const payments = await send('031-H','Pagos y saldos',{phone:good.phone});
  ok('031-H Excel → pagos/saldos conserva demo específico y fact confirmado', payments.messages.length===1 && payments.messages[0].file_name==='demo_payments_balances.mp4' && !payments.beforeFact && !!payments.fact);
  setAction('present_price');
  setWriter(request=> {
    const system = request.messages.find(m=>m.role==='system')?.content ?? '';
    ok('031-H/I Writer recibe precio primero y primeros 30 días, sin instrucción vieja', system.includes('Empieza por el precio') && system.includes('primeros 30 días') &&
      !system.includes('sin costo de setup') && !system.includes('no existe fee por adelantado'));
    return /LEAD: (?:Tengo )?70 alumnos/.test(latestText(request)) ? 'Para 70 alumnos activos son S/267 al mes: S/247 hasta 50 y S/20 por los 20 adicionales.' : price;
  });
  const priced = await send('031-H','Cuanto sale el sistema?',{phone:good.phone});
  ok('031-H precio natural tras demo, acción present_price', priced.messages[0]?.text===price && priced.decision?.plan?.nextAction==='present_price' && !/setup|fee|contrato|adelantado/i.test(priced.messages[0].text));
  for (const [label, text] of [['031-I1','Precio'],['031-I2','Cuánto cuesta?']]) {
    const direct = await send(label,text);
    ok(`${label} precio directo sin pedir cantidad de alumnos`, direct.messages[0]?.text===price && direct.decision?.plan?.nextAction==='present_price' && !(direct.messages[0].text.match(/\?/g)??[]).length);
    if (label==='031-I1') {
      const seventy = await send(label,'Tengo 70 alumnos activos',{phone:direct.phone});
      ok('031-I 70 activos S/267 preservado', seventy.messages[0]?.text.includes('S/267'));
    }
  }
  // Pending acceptance is not a delivered fact: observe before status via provider hook
  // in 029; here send() explicitly submits successful statuses before reading facts.
  const outbox = JSON.stringify((await api('/api/dev/wa-mock/outbox')).json);
  setAction('ask_more_questions'); setWriter(request=>/LEAD: Todos/.test(latestText(request)) ? caption : priorQuestion);
  const preview = await api('/api/lab/preview',{method:'POST',body:JSON.stringify({mode:'published',conversation:[{from:'lead',text:'Con excel'},{from:'lead',text:'Todos'}]})});
  ok('031 sandbox guard de Todos con demo local y cero Graph', preview.res.ok && preview.json?.writer?.text===caption && preview.json?.plan?.next_action==='show_operations_demo' && JSON.stringify((await api('/api/dev/wa-mock/outbox')).json)===outbox);
}
