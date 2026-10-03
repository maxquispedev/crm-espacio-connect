/**
 * Demo 10 — el preview NO es una implementación paralela.
 *
 * La garantía del corte 2 ("Nada de motores paralelos") no se demuestra con
 * tests de comportamiento: se demuestra **estructuralmente**, leyendo el
 * código fuente. Si el preview y el Laboratorio dejaran de compartir el andamiaje
 * —o el preview reimplementara el pipeline comercial— este test falla.
 *
 * Lo que ata:
 *   1. `POST /api/lab/preview` importa el MISMO helper de sandbox que usa
 *      `runConversation` (el Laboratorio), del MISMO módulo.
 *   2. El preview invoca `runSalesOrchestratorTurn`: la misma función del
 *      Laboratorio, no una copia.
 *   3. El preview NO reimplementa ninguna pieza del motor comercial
 *      (estado, Jev, plan, writer) ni toca el remitente real.
 *   4. El runner del Laboratorio, a su vez, usa el helper (y no lo duplica).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const ROUTE = "src/app/api/lab/preview/route.ts";
const RUNNER = "src/server/lab/runner.ts";
const HELPER = "src/server/lab/sandbox-case.ts";

/** Nombres que las funciones importadas usan dentro del archivo. */
function importedName(src: string, module: string, exported: string): string | null {
  const re = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${module.replace("/", "\\/")}["']`,
    "s"
  );
  const match = re.exec(src);
  if (!match?.[1]) return null;
  const names = match[1]
    .split(",")
    .map((s) => s.trim().split(/\s+as\s+/).pop()?.trim() ?? "")
    .filter(Boolean);
  return names.includes(exported) ? exported : null;
}

describe("Demo 10 — el preview comparte el pipeline real (estructural)", () => {
  it("1. preview y Laboratorio importan el MISMO módulo de sandbox", () => {
    expect(source(ROUTE)).toContain('"@/server/lab/sandbox-case"');
    expect(source(RUNNER)).toContain('"@/server/lab/sandbox-case"');
  });

  it("2. los dos importan las mismas funciones del helper", () => {
    for (const exported of [
      "createSandboxCase",
      "cleanupSandboxCase",
      "readSandboxSnapshot",
    ]) {
      expect(
        importedName(source(ROUTE), "@/server/lab/sandbox-case", exported),
        `el preview debe importar ${exported}`
      ).toBe(exported);
      expect(
        importedName(source(RUNNER), "@/server/lab/sandbox-case", exported),
        `el runner del Laboratorio debe importar ${exported}`
      ).toBe(exported);
    }
  });

  it("3. el preview invoca runSalesOrchestratorTurn (la MISMA que el Lab)", () => {
    expect(
      importedName(source(ROUTE), "@/server/sales/orchestrator", "runSalesOrchestratorTurn")
    ).toBe("runSalesOrchestratorTurn");
    expect(
      importedName(source(RUNNER), "@/server/sales/orchestrator", "runSalesOrchestratorTurn")
    ).toBe("runSalesOrchestratorTurn");
    // Y lo llama de verdad, no solo lo importa.
    expect(source(ROUTE)).toMatch(/await runSalesOrchestratorTurn\(/);
  });

  it("4. el preview NO reimplementa ninguna pieza del motor comercial", () => {
    const route = source(ROUTE);
    const prohibido = [
      ["@/server/sales/build-state", "construcción del State de Jev"],
      ["@/server/sales/client", "cliente de Jev"],
      ["@/server/sales/writer", "writer comercial"],
      ["@/server/sales/resolve-plan", "resolver de plan"],
      ["@/server/sales/follow-ups", "follow-ups"],
      ["@/server/inbox/send", "remitente real de WhatsApp"],
      ["@/lib/meta", "Graph API / CAPI"],
    ] as const;
    for (const [modulo, que] of prohibido) {
      expect(
        route.includes(`"${modulo}"`),
        `el preview no debe importar ${modulo} (${que})`
      ).toBe(false);
    }
  });

  it("5. el runner del Laboratorio no duplica el andamiaje que se extrajo", () => {
    const runner = source(RUNNER);
    // El contacto archivado, el lead del sandbox y la conversación `is_test`
    // se crean en el helper. Si reaparecen aquí, alguien duplicó.
    expect(runner).not.toMatch(/insert\(schema\.contact\)/);
    expect(runner).not.toMatch(/insert\(schema\.conversation\)/);
    expect(runner).not.toMatch(/createLeadInStage\(/);
    expect(runner).not.toMatch(/findFirstOpenStage\(/);
  });

  it("6. el helper es el único que crea el caso sandbox", () => {
    const helper = source(HELPER);
    // `is_test=true` vive en el helper, no duplicado en el endpoint.
    expect(helper).toMatch(/isTest:\s*true/);
    expect(helper).toMatch(/archivedAt:\s*new Date\(\)/);
    expect(helper).toContain('reason: "lab_sandbox"');
  });

  it("7. el preview resuelve la versión con el loader, no con un id del body", () => {
    const route = source(ROUTE);
    expect(importedName(route, "@/lib/sales/playbook/loader", "getDraftConfigForOrg")).toBe(
      "getDraftConfigForOrg"
    );
    expect(
      importedName(route, "@/lib/sales/playbook/loader", "getPublishedConfigForOrg")
    ).toBe("getPublishedConfigForOrg");
    // Y `organizationId` sale de la sesión, no del body.
    expect(route).toMatch(/const organizationId = session\.organizationId;/);
  });
});
