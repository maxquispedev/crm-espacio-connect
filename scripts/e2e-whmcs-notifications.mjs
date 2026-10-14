/** Spec 021: disposable local PostgreSQL + Next + Graph stub. No real credentials. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const pgModule = process.env.E2E_EMBEDDED_POSTGRES_MODULE;
if (!pgModule?.startsWith('/tmp/')) throw new Error('Provide E2E_EMBEDDED_POSTGRES_MODULE in /tmp (temporary embedded-postgres install)');
const { default: EmbeddedPostgres } = await import(pgModule);
const dir = await mkdtemp(join(tmpdir(), 'whmcs-021-'));
const pg = new EmbeddedPostgres({ databaseDir: join(dir, 'pg'), user: 'whmcs_test', password: 'local-test-only', port: 55442, persistent: true });
const BASE = 'http://127.0.0.1:3021';
const SECRET = 'whmcs-local-test-only-secret';
const key = randomBytes(32);
let app, sql, graph;
const outbox = [];
let rejectGraph = false;
const check = (value, message) => { assert.ok(value, message); console.log(`PASS ${message}`); };
try {
  await pg.initialise(); await pg.start(); await pg.createDatabase('whmcs_notifications_test');
  const dbUrl = 'postgresql://whmcs_test:local-test-only@127.0.0.1:55442/whmcs_notifications_test';
  sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: join(process.cwd(), 'drizzle') });
  graph = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    // Only accept the fixture's messages path; fail closed on any unexpected request.
    assert.equal(req.url, '/v25.0/pn-test/messages');
    outbox.push(JSON.parse(raw));
    res.writeHead(rejectGraph ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rejectGraph ? { error: { message: 'fixture unavailable' } } : { messages: [{ id: `wamid.fixture-${outbox.length}` }] }));
  });
  await new Promise(resolve => graph.listen(3034, '127.0.0.1', resolve));
  await sql`insert into organization (id,name,slug) values ('org_ev','Espacio Veloz','espacio-veloz'), ('org_other','Other','other')`;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update('fixture-token', 'utf8'), cipher.final()]).toString('base64');
  await sql`insert into meta_credentials (id,organization_id,waba_id,phone_number_id,token_cipher,token_iv,token_tag,status)
    values ('mc','org_ev','waba-test','pn-test',${encrypted},${iv.toString('base64')},${cipher.getAuthTag().toString('base64')},'connected')`;
  for (const name of ['invoice_reminder', 'service_suspended', 'invoice_created', 'invoice_paid']) {
    const body = name === 'invoice_created' ? '{{1}} / {{2}} / {{3}} / {{4}} / {{5}}' : '{{1}} / {{2}} / {{3}} / {{4}}';
    for (const [org, lang] of [['org_ev', name === 'invoice_created' || name === 'invoice_paid' ? 'es_MX' : 'es_PE'], ['org_other', 'es_PE'], ['org_ev', 'es']]) {
      await sql`insert into template (id,organization_id,name,language,category,body,status) values
        (${`${org}-${name}-${lang}`},${org},${name},${lang},'UTILITY',${body},'approved')`;
    }
  }
  const env = { ...process.env, APP_BASE_URL: BASE, DATABASE_URL: dbUrl, BETTER_AUTH_SECRET: 'auth-local-test-only-secret',
    ENCRYPTION_KEY: key.toString('base64'), META_WEBHOOK_VERIFY_TOKEN: 'verify-local-only', WHMCS_WEBHOOK_SECRET: SECRET,
    META_GRAPH_BASE_URL: 'http://127.0.0.1:3034', META_GRAPH_API_VERSION: 'v25.0', WA_MOCK_ENABLED: 'true',
    NODE_ENV: 'development', OPENROUTER_API_TOKEN: '', TYPESAFE_API_KEY: '', ATRIBUCION: 'off', MEDIA_DIR: join(dir,'media') };
  const log = createWriteStream(join(dir, 'next.log'));
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3021'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.pipe(log); app.stderr.pipe(log);
  let ready = false;
  for (let i = 0; i < 90; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 500)); }
  check(ready, `app ready; log ${dir}/next.log`);
  async function post(body, invalid = false) {
    const raw = JSON.stringify(body), ts = String(Math.floor(Date.now()/1000));
    const signature = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
    const res = await fetch(`${BASE}/api/integrations/whmcs/events`, { method: 'POST', body: raw, headers: {
      'content-type': 'application/json', 'x-ev-timestamp': ts, 'x-ev-signature': invalid ? 'sha256=00' : `sha256=${signature}` } });
    return { status: res.status, json: await res.json() };
  }
  const client = { id: 123, name: 'Mateo', phone: '51999999999' };
  const reminder = { event: 'invoice.reminder', reminderId: 'due-2026-10-15', invoiceId: 1296, client,
    invoice: { number: 'F-1296', currency: 'USD', total: '49.99', dueDate: '2026-10-15' } };
  const suspended = { event: 'service.suspended', suspensionId: 'transition-1', serviceId: 42, invoiceId: 1296, client,
    service: { productName: 'Espacio Impulsa', domain: 'ejemplo.com', status: 'Suspended', suspensionReason: 'nonpayment' },
    invoice: { serviceId: 42, number: 'F-1296', currency: 'USD', balance: '49.99', status: 'Unpaid' } };
  for (const [payload, name, values] of [[reminder,'invoice_reminder',['Mateo','F-1296','49.99 USD','15/10/2026']],
      [suspended,'service_suspended',['Mateo','Espacio Impulsa - ejemplo.com','F-1296','49.99 USD']]]) {
    check((await post(payload,true)).status === 401, `${name} invalid HMAC`);
    check((await post({ ...payload, templateId: 'evil' })).status === 400, `${name} internal selector rejected`);
    const result = await post(payload); check(result.status === 200 && result.json.status === 'completed', `${name} accepted`);
    const sent = outbox.at(-1); assert.equal(sent.template.name, name); assert.equal(sent.template.language.code, 'es_PE');
    assert.deepEqual(sent.template.components[0].parameters.map(p => p.text), values);
    assert.equal(sent.template.components[1].parameters[0].text, '1296');
    check(true, `${name} Graph variables/language/button`);
    const [msg] = await sql`select text,status,organization_id,wa_message_id from message where id=${result.json.messageId}`;
    check(msg.status === 'pending' && msg.wa_message_id?.startsWith('wamid.fixture-') && msg.organization_id === 'org_ev' && values.every(v => msg.text.includes(v)), `${name} visible outbound persisted`);
    const count = outbox.length; const dup = await post(payload);
    check(dup.json.duplicate && outbox.length === count, `${name} duplicate no send`);
  }
  const noInvoice = { ...suspended, suspensionId: 'transition-missing', invoiceId: null, invoice: null };
  const count = outbox.length;
  check((await post(noInvoice)).json.error?.code === 'invoice_unavailable', 'missing invoice controlled');
  check((await post(noInvoice)).json.status === 'failed' && outbox.length === count, 'missing invoice failed retry no send');
  const [failed] = await sql`select status from integration_event where external_id=${JSON.stringify(['42','transition-missing'])}`;
  check(failed.status === 'failed', 'missing invoice durable failure');
  await sql`update template set status='pending' where organization_id='org_ev' and name='invoice_reminder' and language='es_PE'`;
  check((await post({ ...reminder, reminderId:'pending-template' })).json.error?.code === 'template_unavailable' && outbox.length === count, 'pending es_PE does not fall back to approved es/other tenant');
  await sql`update template set status='approved' where organization_id='org_ev' and name='invoice_reminder' and language='es_PE'`;
  const concurrency = await Promise.all([post({ ...reminder, reminderId:'concurrent' }),post({ ...reminder, reminderId:'concurrent' })]);
  check(concurrency.filter(r => r.json.duplicate).length === 1 && outbox.length === count+1, 'database UNIQUE concurrent duplicate');
  await post({ ...suspended, serviceId: 43, invoice: { ...suspended.invoice, serviceId: 43 } });
  await post({ ...suspended, suspensionId:'transition-2' });
  check(outbox.length === count+3, 'different service same invoice and future suspension send');
  await sql`update conversation set is_test=true where organization_id='org_ev'`;
  const sandboxResult = await post({ ...reminder, reminderId:'sandbox' });
  const [sandboxMessage] = await sql`select c.is_test from message m join conversation c on c.id=m.conversation_id where m.id=${sandboxResult.json.messageId}`;
  check(sandboxResult.json.status === 'completed' && sandboxMessage.is_test === false, 'ingest selects new real conversation instead of sandbox');
  rejectGraph = true;
  check((await post({ ...reminder, reminderId:'provider-down' })).status >= 400, 'Graph outage controlled');
  const afterFailure = outbox.length;
  check((await post({ ...reminder, reminderId:'provider-down' })).json.status === 'failed' && outbox.length === afterFailure, 'Graph failure no retry');
  rejectGraph = false;
  for (const payload of [{ ...reminder, event:'invoice.created', items:[{description:'Hosting'}] },
      { event:'invoice.paid', invoiceId:1296, client, invoice:{number:'F-1296',total:'49.99',currency:'USD',paidAt:'2026-10-14 10:00:00'} }]) {
    check((await post(payload)).json.status === 'completed', `${payload.event} regression accepted`);
  }
  check(outbox.at(-1).template.components.length === 1, 'paid has no button');
  const contacts = await sql`select id from contact where organization_id='org_ev'`;
  check(contacts.length === 1, 'contact reused');
  console.log('E2E WHMCS 021 complete');
} finally {
  if (app) { const exited = new Promise(resolve => app.once('exit', resolve)); app.kill('SIGTERM'); await exited; }
  if (graph) await new Promise(resolve => graph.close(resolve));
  if (sql) await sql.end();
  await pg.stop();
}
