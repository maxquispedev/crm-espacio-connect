/**
 * Sales Playbook — Tarjeta de la versión PUBLICADA (Corte 4, Feature 008, T403).
 *
 * Muestra la versión en vigor: metadatos (versión, schema, fecha,
 * notas), un mini-resumen legible del contenido (producto,
 * prioridades primarias, precio) y los badges por clase de pregunta
 * Jev. Offer.createDraft: "Crear draft desde esta versión".
 *
 * Es **solo lectura**: las preguntas Jev no se editan aquí (Corte 5).
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  countJevByClass,
  formatDateTime,
  formatPricing,
  jevClassIcon,
  jevClassLabel,
} from "./summary";
import type { JevQuestionClass } from "@/lib/sales/playbook/constants";
import type { PlaybookVersionDto } from "./types";

const JEV_BADGE_VARIANT: Record<JevQuestionClass, "destructive" | "warning" | "secondary"> = {
  "engine-required": "destructive",
  "known-signal": "warning",
  analytical: "secondary",
};

export function PlaybookPublishedCard({
  published,
  hasDraft,
  onCreateDraft,
  onShowHistory,
  creatingDraft,
}: {
  published: PlaybookVersionDto;
  /** Si ya hay un draft abierto, el botón de crear draft se deshabilita. */
  hasDraft: boolean;
  onCreateDraft: () => void;
  onShowHistory: () => void;
  creatingDraft: boolean;
}) {
  const counts = countJevByClass(published.jev_questions);
  const primary = published.priorities.primary;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>
              Versión publicada V{published.version_number}
            </CardTitle>
            <CardDescription>
              schema {published.schema_version} · publicada{" "}
              {formatDateTime(published.published_at)}
            </CardDescription>
          </div>
          <Badge variant="success">En vigor</Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {published.notes ? (
          <p className="rounded-md border bg-secondary/40 px-3 py-2 text-sm text-text-2">
            {published.notes}
          </p>
        ) : null}

        {/* Mini-resumen del contenido */}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Producto
            </dt>
            <dd className="text-sm font-medium">{published.product.name}</dd>
            <dd className="text-xs text-muted-foreground">
              {published.product.one_liner}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Precio
            </dt>
            <dd className="text-sm">{formatPricing(published.offer)}</dd>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Prioridades primarias
            </dt>
            <dd>
              {primary.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {primary.map((p, i) => (
                    <li key={`${p}-${i}`}>
                      <Badge variant="secondary" className="font-normal">
                        {i + 1}. {p}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Sin prioridades primarias
                </span>
              )}
            </dd>
          </div>
        </dl>

        {/* Clases de preguntas Jev (solo conteo: se editan en Corte 5) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Preguntas Jev ({Object.keys(published.jev_questions).length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={JEV_BADGE_VARIANT["engine-required"]}>
              {jevClassIcon("engine-required")} {jevClassLabel("engine-required")}:{" "}
              {counts["engine-required"]}
            </Badge>
            <Badge variant={JEV_BADGE_VARIANT["known-signal"]}>
              {jevClassIcon("known-signal")} {jevClassLabel("known-signal")}:{" "}
              {counts["known-signal"]}
            </Badge>
            <Badge variant={JEV_BADGE_VARIANT.analytical}>
              {jevClassIcon("analytical")} {jevClassLabel("analytical")}:{" "}
              {counts.analytical}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onCreateDraft}
            disabled={hasDraft || creatingDraft}
            title={
              hasDraft
                ? "Ya hay un draft abierto"
                : "Crear un draft a partir de la versión publicada"
            }
          >
            {creatingDraft ? "Creando draft…" : "Crear draft desde esta versión"}
          </Button>
          <Button variant="outline" onClick={onShowHistory}>
            Ver historial
          </Button>
        </div>
        {hasDraft ? (
          <p className="text-xs text-muted-foreground">
            Ya existe un draft abierto: ciérralo (guarda y publica) o elimínalo
            antes de crear otro desde esta versión.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
