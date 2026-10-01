/**
 * Sales Playbook — Historial de versiones (Corte 4, Feature 008, T405).
 *
 * Tabla con `version_number`, `status`, `created_at`, `published_at`,
 * `archived_at` y `notes`. Al hacer click en una fila se despliega el
 * detalle (producto, precio, prioridades, conteo Jev) y, si la fila es
 * `archived` y NO es la publicada actual, aparece "Rollback a esta
 * versión" (T406).
 *
 * El detalle se pide bajo demanda a `GET /api/playbook/versions/:id`;
 * la lista (summary) no trae el config completo para no inflar el
 * payload.
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  countJevByClass,
  formatBytes,
  formatDateTime,
  formatPricing,
} from "./summary";
import type {
  PlaybookVersionDto,
  PlaybookVersionStatus,
  PlaybookVersionSummaryDto,
} from "./types";

const STATUS_VARIANT: Record<
  PlaybookVersionStatus,
  "success" | "warning" | "secondary"
> = {
  published: "success",
  draft: "warning",
  archived: "secondary",
};

const STATUS_LABEL: Record<PlaybookVersionStatus, string> = {
  published: "Publicada",
  draft: "Draft",
  archived: "Archivada",
};

export function PlaybookVersionsList({
  versions,
  publishedId,
  onRollback,
  rollingBackId,
}: {
  versions: PlaybookVersionSummaryDto[];
  /** Id de la versión publicada actualmente (la que NO se puede "rollbackear"). */
  publishedId: string | null;
  onRollback: (versionId: string, versionNumber: number) => void;
  rollingBackId: string | null;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<PlaybookVersionDto | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  const toggleRow = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/playbook/versions/${id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setDetailError(body?.message ?? "No se pudo cargar el detalle de la versión");
        return;
      }
      const body = (await res.json()) as { version: PlaybookVersionDto };
      setDetail(body.version);
    } catch {
      setDetailError("No se pudo cargar el detalle de la versión");
    } finally {
      setDetailLoading(false);
    }
  };

  if (versions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historial de versiones</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Todavía no hay versiones registradas.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de versiones</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-medium">Versión</th>
                <th className="px-2 py-2 font-medium">Estado</th>
                <th className="px-2 py-2 font-medium">Creada</th>
                <th className="px-2 py-2 font-medium">Publicada</th>
                <th className="px-2 py-2 font-medium">Archivada</th>
                <th className="px-2 py-2 font-medium">Notas</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const isOpen = openId === v.id;
                const canRollback = v.status === "archived" && v.id !== publishedId;
                return (
                  <React.Fragment key={v.id}>
                    <tr
                      onClick={() => void toggleRow(v.id)}
                      className="cursor-pointer border-b border-border/60 transition-colors hover:bg-secondary/40"
                      aria-expanded={isOpen}
                    >
                      <td className="px-2 py-2 font-medium">
                        V{v.version_number}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {formatBytes(v.size_bytes)}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={STATUS_VARIANT[v.status]}>
                          {STATUS_LABEL[v.status]}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {formatDateTime(v.created_at)}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {formatDateTime(v.published_at)}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {formatDateTime(v.archived_at)}
                      </td>
                      <td className="max-w-[220px] truncate px-2 py-2 text-text-2">
                        {v.notes ?? "—"}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-border/60 bg-secondary/20">
                        <td colSpan={6} className="px-2 py-3">
                          {detailLoading ? (
                            <p className="text-sm text-muted-foreground">
                              Cargando detalle…
                            </p>
                          ) : detailError ? (
                            <p className="text-sm text-danger-text" role="alert">
                              {detailError}
                            </p>
                          ) : detail ? (
                            <div className="flex flex-col gap-3">
                              <dl className="grid gap-3 sm:grid-cols-2">
                                <div className="flex flex-col gap-0.5">
                                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Producto
                                  </dt>
                                  <dd className="text-sm font-medium">
                                    {detail.product.name}
                                  </dd>
                                  <dd className="text-xs text-muted-foreground">
                                    {detail.product.one_liner}
                                  </dd>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Precio
                                  </dt>
                                  <dd className="text-sm">
                                    {formatPricing(detail.offer)}
                                  </dd>
                                </div>
                                <div className="flex flex-col gap-1 sm:col-span-2">
                                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Prioridades primarias
                                  </dt>
                                  <dd className="text-sm text-text-2">
                                    {detail.priorities.primary.join(" · ") || "—"}
                                  </dd>
                                </div>
                                <div className="flex flex-col gap-1 sm:col-span-2">
                                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Preguntas Jev
                                  </dt>
                                  <dd className="text-sm text-text-2">
                                    {Object.keys(detail.jev_questions).length} ·{" "}
                                    {countJevByClass(detail.jev_questions)[
                                      "engine-required"
                                    ]}{" "}
                                    obligatorias
                                  </dd>
                                </div>
                              </dl>

                              {canRollback ? (
                                <div>
                                  <Button
                                    variant="secondary"
                                    onClick={() =>
                                      onRollback(detail.id, detail.version_number)
                                    }
                                    disabled={rollingBackId === detail.id}
                                  >
                                    {rollingBackId === detail.id
                                      ? "Publicando…"
                                      : `Rollback a V${detail.version_number}`}
                                  </Button>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Republica este contenido. La versión publicada
                                    actual se archiva; se te pedirá un motivo.
                                  </p>
                                </div>
                              ) : null}
                              {!canRollback && detail.id === publishedId ? (
                                <p className="text-xs text-muted-foreground">
                                  Esta es la versión en vigor; no se puede
                                  republicar a sí misma.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
