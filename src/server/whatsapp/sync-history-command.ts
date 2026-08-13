import { requestCoexistenceSyncForOrg } from "@/server/whatsapp/smb-app-data";

export type SyncHistoryArgs = {
  organizationId?: string;
  orgSlug?: string;
};

export type ConnectedOrg = {
  id: string;
  slug: string | null;
  name: string;
};

export type SyncHistoryCommandDeps = {
  findOrgBySlug: (slug: string) => Promise<ConnectedOrg | null>;
  findOrgById: (id: string) => Promise<ConnectedOrg | null>;
  listConnectedOrgs: () => Promise<ConnectedOrg[]>;
  requestSync: typeof requestCoexistenceSyncForOrg;
};

/**
 * CLI: pnpm whatsapp:sync-history [--org-slug=…] [--organization-id=…]
 */
export function parseSyncHistoryArgs(argv: string[]): SyncHistoryArgs {
  const args: SyncHistoryArgs = {};
  for (const raw of argv) {
    if (raw.startsWith("--org-slug=")) {
      args.orgSlug = raw.slice("--org-slug=".length).trim();
    } else if (raw.startsWith("--organization-id=")) {
      args.organizationId = raw.slice("--organization-id=".length).trim();
    } else if (raw === "--help" || raw === "-h") {
      throw new Error(
        'Uso: pnpm whatsapp:sync-history [--org-slug=mi-negocio] [--organization-id=org_xxx]\n' +
          "Sin flags: usa la única organización con WhatsApp conectado."
      );
    } else if (raw.startsWith("--")) {
      throw new Error(`Flag desconocido: ${raw}`);
    }
  }
  if (args.orgSlug === "") {
    throw new Error("--org-slug no puede estar vacío");
  }
  if (args.organizationId === "") {
    throw new Error("--organization-id no puede estar vacío");
  }
  return args;
}

export type SyncHistoryCommandResult =
  | {
      status: "ok";
      organizationId: string;
      orgSlug: string | null;
      phoneNumberId: string;
      contactsOk: boolean;
      historyOk: boolean;
      contactsRequestId: string | null;
      historyRequestId: string | null;
      contactsError?: string;
      historyError?: string;
    }
  | { status: "aborted"; reason: "org_not_found" | "not_connected" | "ambiguous"; detail: string };

export async function runSyncHistoryCommand(
  args: SyncHistoryArgs,
  deps: SyncHistoryCommandDeps
): Promise<SyncHistoryCommandResult> {
  let org: ConnectedOrg | null = null;

  if (args.organizationId) {
    org = await deps.findOrgById(args.organizationId);
    if (!org) {
      return {
        status: "aborted",
        reason: "org_not_found",
        detail: `organización no encontrada: ${args.organizationId}`,
      };
    }
  } else if (args.orgSlug) {
    org = await deps.findOrgBySlug(args.orgSlug);
    if (!org) {
      return {
        status: "aborted",
        reason: "org_not_found",
        detail: `slug no encontrado: ${args.orgSlug}`,
      };
    }
  } else {
    const connected = await deps.listConnectedOrgs();
    if (connected.length === 0) {
      return {
        status: "aborted",
        reason: "not_connected",
        detail: "no hay ninguna organización con WhatsApp conectado",
      };
    }
    if (connected.length > 1) {
      const list = connected
        .map((o) => `  ${o.slug ?? o.id}  (${o.name})`)
        .join("\n");
      return {
        status: "aborted",
        reason: "ambiguous",
        detail:
          "hay más de una organización conectada; pasa --org-slug o --organization-id:\n" +
          list,
      };
    }
    org = connected[0] ?? null;
    if (!org) {
      return {
        status: "aborted",
        reason: "not_connected",
        detail: "no hay ninguna organización con WhatsApp conectado",
      };
    }
  }

  const sync = await deps.requestSync(org.id);
  if (!sync.ok) {
    return {
      status: "aborted",
      reason: "not_connected",
      detail: `la organización ${org.slug ?? org.id} no tiene credenciales de WhatsApp`,
    };
  }

  return {
    status: "ok",
    organizationId: org.id,
    orgSlug: org.slug,
    phoneNumberId: sync.phoneNumberId,
    contactsOk: sync.result.contacts.ok,
    historyOk: sync.result.history.ok,
    contactsRequestId: sync.result.contacts.requestId,
    historyRequestId: sync.result.history.requestId,
    contactsError: sync.result.contacts.error,
    historyError: sync.result.history.error,
  };
}
