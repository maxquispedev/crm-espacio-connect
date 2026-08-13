"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import {
  mapOrganizationList,
  switchActiveOrganization,
  type OrgOption,
} from "@/lib/auth/switch-organization";
import { cn } from "@/lib/utils";

/**
 * Selector compacto de organización activa (Better Auth list + setActive).
 * Tras un cambio exitoso recarga la página completa para aislar estado/SSE.
 */
export function OrganizationSwitcher({
  organizationId,
}: {
  organizationId: string;
}) {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await authClient.organization.list();
      if (cancelled) return;
      if (error) {
        setListError("No se pudieron cargar las organizaciones");
        setOrgs([]);
        setLoaded(true);
        return;
      }
      setOrgs(mapOrganizationList(data));
      setListError(null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSelect(selectedId: string) {
    setSwitchError(null);
    setSwitching(true);
    try {
      const result = await switchActiveOrganization({
        currentOrganizationId: organizationId,
        selectedId,
        setActive: (args) => authClient.organization.setActive(args),
        reload: () => {
          window.location.reload();
        },
      });
      if (result.action === "error") {
        setSwitchError(result.message);
      }
      // noop / reloaded: no tocar el valor visual; reload limpia todo.
    } finally {
      setSwitching(false);
    }
  }

  const singleOrEmpty = orgs.length <= 1;
  const selectValue =
    orgs.some((o) => o.id === organizationId) && orgs.length > 0
      ? organizationId
      : (orgs[0]?.id ?? organizationId);

  return (
    <div className="mt-2 space-y-1">
      <label
        htmlFor="org-switcher"
        className="block text-[11px] font-medium text-text-3"
      >
        Organización
      </label>
      {!loaded ? (
        <p className="text-[12px] text-text-3">Cargando…</p>
      ) : listError ? (
        <p className="text-[12px] text-destructive">{listError}</p>
      ) : orgs.length === 0 ? (
        <p className="text-[12px] text-text-3">Sin organizaciones</p>
      ) : (
        <select
          id="org-switcher"
          aria-label="Organización activa"
          className={cn(
            "w-full rounded-sm border border-border bg-background px-2 py-1.5 text-[13px] font-medium text-foreground",
            "focus:outline-none focus:ring-1 focus:ring-brand",
            (switching || singleOrEmpty) && "cursor-not-allowed opacity-70"
          )}
          value={selectValue}
          disabled={switching || singleOrEmpty}
          onChange={(e) => {
            void onSelect(e.target.value);
          }}
        >
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      )}
      {switchError && (
        <p className="text-[11px] text-destructive" role="alert">
          {switchError}
        </p>
      )}
    </div>
  );
}
