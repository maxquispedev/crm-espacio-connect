/**
 * 014 C7 — Capturas de la UI real (Playwright) para revisar el rediseño a ojo.
 * No es un test: no falla, solo deja PNGs en /tmp/shots-c7 para inspección.
 * Uso: node --env-file=.env scripts/screenshot-c7.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3200";
const { chromium } = await import("playwright");
const { mkdirSync } = await import("node:fs");

const DIR = process.env.SHOT_DIR ?? "/tmp/shots-c7";
mkdirSync(DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  colorScheme: process.env.SHOT_SCHEME ?? "dark",
});

// Sesión por la puerta real del producto (misma cuenta fixture del E2E).
await page.goto(`${BASE}/login`);
await page.fill("#email", "e2e@vocero.test");
await page.fill("#password", "password-e2e-123");
await page.click('button[type="submit"]');
await page.waitForURL(/inbox|pipeline|contacts/, { timeout: 30000 });

const irA = async (path) => {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(3500);
};

// La org A del E2E es la que tiene la cola poblada ("Workspace E2E A").
const orgs = (await (await page.request.get(`${BASE}/api/auth/organization/list`)).json()) ?? [];
console.log("orgs:", orgs.map((o) => o.slug ?? o.name).join(" | "));
const a = orgs.find((o) => String(o.slug ?? "").startsWith("ws026-a"));
if (!a) throw new Error("no se encontró la organización del fixture");
// Better Auth valida Origin (CSRF) también en este endpoint: sin la cabecera, el
// set-active responde 403 y la captura sale de la organización equivocada.
const activo = await page.request.post(`${BASE}/api/auth/organization/set-active`, {
  headers: { origin: BASE, "content-type": "application/json" },
  data: { organizationId: a.id },
});
console.log("set-active:", activo.status(), activo.ok() ? "ok" : await activo.text());

for (const [nombre, path] of [
  ["inbox", "/inbox"],
  ["agenda", "/agenda"],
  ["pipeline", "/pipeline"],
  ["contactos", "/contacts"],
  ["agente", "/agent"],
]) {
  await irA(path);
  await page.screenshot({ path: `${DIR}/${nombre}.png` });
  console.log("capturado", nombre);
}

// La Bandeja con una conversación abierta: es donde se ve el estado en la cabecera.
await irA("/inbox");
const fila = page.locator("[data-testid='conversation-item']").first();
if (await fila.count()) {
  await fila.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/inbox-abierta.png` });
  console.log("capturado inbox-abierta");
}

await browser.close();
