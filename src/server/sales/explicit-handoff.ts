import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * El prospecto pidió humano de forma explícita. No pasa por Jev.
 * Si no hay lead, el UPDATE no toca filas y no lanza.
 */
export async function persistClientHumanRequest(input: {
  organizationId: string;
  contactId: string;
}): Promise<void> {
  const now = new Date();
  const db = getDb();
  await db
    .update(schema.lead)
    .set({
      automationLane: "human",
      humanRequestedAt: now,
      updatedAt: now,
    })
    .where(
      scoped(
        schema.lead.organizationId,
        input.organizationId,
        eq(schema.lead.contactId, input.contactId)
      )
    );
}
