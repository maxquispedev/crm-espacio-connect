/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const {
      cleanupOrphanRuns,
      startSalesFollowUpWorker,
      bootstrapAllEnabledOrgs,
    } = await import("./instrumentation-node");
    await cleanupOrphanRuns();
    // 008 — Sembrar el playbook V1 para todas las orgs con Sales
    // Orchestrator activo. Best-effort: la BD puede no estar lista aún
    // (migraciones corren antes del server, pero si fallan aquí se
    // reintentará en el próximo arranque).
    try {
      await bootstrapAllEnabledOrgs();
    } catch (err) {
      console.error("[boot] playbook bootstrap falló:", err);
    }
    startSalesFollowUpWorker();
  }
}
