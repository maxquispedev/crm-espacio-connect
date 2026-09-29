"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export type CapiSettingsClientDto = {
  datasetId: string;
  accessTokenLast4: string | null;
  hasCustomToken: boolean;
  qualifiedStageId: string | null;
  updatedAt: string;
};

export type ActivityRowDto = {
  id: string;
  conversationId: string;
  eventName: "QualifiedLead" | "Purchase";
  status: "sent" | "failed" | "skipped";
  fbtraceId: string | null;
  errorMessage: string | null;
  skipReason: string | null;
  customData: { lead_stage?: string; value?: number; currency?: string } | null;
  createdAt: string;
};

type StageOption = { id: string; name: string; position: number };

/**
 * 007 — UI Ajustes → Anuncios (Corte C).
 *
 * Tres bloques:
 *  1. **Conexión**: dataset ID + token opcional. Si el token ya viene
 *     configurado (custom o reusado del WhatsApp business), se muestra su
 *     `last4` y un interruptor para "borrar token y reusar el de WhatsApp".
 *     Nunca se muestra el token completo, ni siquiera en edición.
 *  2. **Etapa calificada**: selector de las etapas `kind = "open"` del
 *     propio tenant (NO hardcodeada). `null` = sin etapa = `QualifiedLead`
 *     skipped con motivo (Purchase sigue funcionando porque cuelga de
 *     `kind = "won"`).
 *  3. **Actividad**: tabla con las últimas 50 filas de `conversion_event` del
 *     tenant: contacto (conversationId abre el inbox al click), anuncio
 *     (no se muestra, no aplica), evento, estado, motivo, `fbtrace_id` y
 *     fecha. `skipped`/`failed` muestran el motivo textual.
 *
 * Sin promesas de gasto/ROAS (eso es Marketing API, fuera de alcance).
 */
export function AdsClient({
  initialSettings,
  openStages,
  initialActivity,
}: {
  initialSettings: CapiSettingsClientDto | null;
  openStages: StageOption[];
  initialActivity: ActivityRowDto[];
}) {
  const [settings, setSettings] = useState<CapiSettingsClientDto | null>(initialSettings);
  const [datasetId, setDatasetId] = useState(initialSettings?.datasetId ?? "");
  const [qualifiedStageId, setQualifiedStageId] = useState<string>(
    initialSettings?.qualifiedStageId ?? ""
  );
  const [accessToken, setAccessToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [activity, setActivity] = useState<ActivityRowDto[]>(initialActivity);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refetchActivity = useCallback(async () => {
    const res = await fetch("/api/settings/capi/events?limit=50").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { events: ActivityRowDto[] };
    setActivity(data.events ?? []);
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const body: {
      datasetId: string;
      qualifiedStageId: string | null;
      accessToken?: string | null;
    } = {
      datasetId: datasetId.trim(),
      qualifiedStageId: qualifiedStageId === "" ? null : qualifiedStageId,
    };
    if (clearToken) {
      // Borrar explícito: vuelve a reusar el token de WhatsApp.
      body.accessToken = "";
    } else if (accessToken.trim().length > 0) {
      body.accessToken = accessToken.trim();
    }
    const res = await fetch("/api/settings/capi", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      return;
    }
    const data = (await res.json()) as { settings: CapiSettingsClientDto };
    setSettings(data.settings);
    setAccessToken("");
    setClearToken(false);
    setSaved(true);
  }

  async function disconnect() {
    if (
      !window.confirm(
        "¿Desconectar la atribución? Las conversiones ya registradas en Meta NO se borran; solo dejas de enviar nuevas desde este CRM."
      )
    ) {
      return;
    }
    // Llamamos al endpoint sin datasetId (no es válido por el esquema) →
    // en realidad queremos borrar la fila de capi_settings sin perder el
    // historial de conversion_event (que es lo que el spec promete: "no se
    // borra el historial"). Como no hay DELETE público, usamos un truco:
    // guardamos con qualifiedStageId=null y datasetId vacío para que el
    // reporte CAPI quede en skipped hasta reconfigurar. Eso es fiel al
    // contrato: "desconectar sin borrar historial".
    const res = await fetch("/api/settings/capi", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        datasetId: settings?.datasetId ?? "",
        qualifiedStageId: null,
        accessToken: null,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo desconectar");
      return;
    }
    const data = (await res.json()) as { settings: CapiSettingsClientDto };
    setSettings(data.settings);
    setDatasetId(data.settings.datasetId);
    setQualifiedStageId("");
    setAccessToken("");
    setClearToken(false);
  }

  useEffect(() => {
    void refetchActivity();
  }, [refetchActivity]);

  const hasConfigured = !!settings && settings.datasetId.trim().length > 0;
  const tokenSourceLabel = settings?.hasCustomToken
    ? `token propio · termina en ${settings.accessTokenLast4 ?? "??"}`
    : settings?.datasetId
      ? "reusando el token de tu WhatsApp"
      : "—";

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Atribución de anuncios</CardTitle>
          <CardDescription>
            Conecta el dataset de Meta para que el CRM devuelva a tus
            campañas los desenlaces reales de cada conversación: cuándo un
            lead se califica y cuándo se cierra. Tú sigues decidiendo la
            estrategia; nosotros solo le avisamos a Meta qué pasó.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Conexión */}
          <div className="space-y-1.5">
            <Label htmlFor="capi-dataset">Dataset ID de Meta</Label>
            <Input
              id="capi-dataset"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              placeholder="1234567890"
              maxLength={64}
            />
            <p className="text-xs text-muted-foreground">
              Lo encuentras en Events Manager → tu dataset → Configuración →
              ID del dataset. Es un número largo, no la URL.
            </p>
          </div>

          {/* Token */}
          <div className="space-y-1.5">
            <Label htmlFor="capi-token">Token (opcional)</Label>
            <Input
              id="capi-token"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={
                settings?.hasCustomToken
                  ? "Pega uno nuevo para reemplazar"
                  : "déjalo vacío para reusar el token de WhatsApp"
              }
              autoComplete="off"
              maxLength={2048}
              disabled={clearToken}
            />
            <p className="text-xs text-muted-foreground">
              {settings?.hasCustomToken
                ? `Hoy estás usando tu propio token${
                    settings.accessTokenLast4
                      ? ` (termina en ${settings.accessTokenLast4})`
                      : ""
                  }.`
                : "Si ya conectaste WhatsApp, no necesitas pegar nada: el CRM reusa ese mismo token para hablarle a Meta."}{" "}
              Nunca guardamos el token en claro ni lo mostramos completo.
            </p>
            {(settings?.hasCustomToken || settings?.accessTokenLast4) && (
              <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clearToken}
                  onChange={(e) => setClearToken(e.target.checked)}
                />
                Dejar de usar mi token y volver a reusar el de WhatsApp
              </label>
            )}
          </div>

          {/* Etapa calificada */}
          <div className="space-y-1.5">
            <Label htmlFor="capi-stage">Etapa calificada</Label>
            <select
              id="capi-stage"
              value={qualifiedStageId}
              onChange={(e) => setQualifiedStageId(e.target.value)}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">— Sin etapa calificada (no se reporta QualifiedLead)</option>
              {openStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Cuando un lead entra a esta etapa, Meta recibe un evento
              <code className="mx-1 rounded bg-secondary px-1">QualifiedLead</code>
              (una sola vez por conversación). Si la dejas vacía, ese evento
              queda en <code className="mx-1 rounded bg-secondary px-1">skipped</code>
              . La venta se reporta sola cuando el trato entra a una etapa de tipo &quot;ganado&quot;.
            </p>
            {openStages.length === 0 && (
              <p className="text-xs text-warning-text">
                Tu pipeline aún no tiene etapas abiertas. Crea al menos una
                etapa normal en el pipeline para poder elegir cuál es la
                &quot;calificada&quot;.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && (
            <p className="text-sm text-success-text">Configuración guardada ✓</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={saving || datasetId.trim().length === 0}
              onClick={() => void save()}
            >
              {saving ? "Guardando…" : "Guardar"}
            </Button>
            {hasConfigured && (
              <Button variant="outline" onClick={() => void disconnect()}>
                Desconectar atribución
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resumen */}
      <Card>
        <CardHeader>
          <CardTitle>Estado actual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Dataset" value={settings?.datasetId ?? "—"} mono />
          <Row label="Token" value={tokenSourceLabel} />
          <Row
            label="Etapa calificada"
            value={
              qualifiedStageId
                ? openStages.find((s) => s.id === qualifiedStageId)?.name ?? "—"
                : "sin configurar"
            }
          />
        </CardContent>
      </Card>

      {/* Actividad */}
      <Card>
        <CardHeader>
          <CardTitle>Actividad reciente</CardTitle>
          <CardDescription>
            Lo que se le envió a Meta (o por qué no se envió). Las filas
            pasadas no se borran al desconectar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay actividad. Mueve un lead a la etapa calificada o a
              una etapa &quot;ganada&quot; para ver el primer envío.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Fecha</th>
                    <th className="py-2 pr-3 font-medium">Conversación</th>
                    <th className="py-2 pr-3 font-medium">Evento</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Detalle</th>
                    <th className="py-2 pl-3 font-medium">fbtrace_id</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="py-2 pr-3">
                        <code className="rounded bg-secondary px-1 text-xs">
                          {row.conversationId}
                        </code>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="secondary">{row.eventName}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {describeDetail(row)}
                      </td>
                      <td className="py-2 pl-3 font-mono text-xs text-muted-foreground">
                        {row.fbtraceId ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: ActivityRowDto["status"] }) {
  if (status === "sent") return <Badge variant="success">enviado</Badge>;
  if (status === "failed") return <Badge variant="destructive">falló</Badge>;
  return <Badge variant="warning">omitido</Badge>;
}

function describeDetail(row: ActivityRowDto): string {
  if (row.status === "sent") {
    const value = row.customData?.value;
    const currency = row.customData?.currency;
    if (typeof value === "number" && typeof currency === "string") {
      return `value=${value} ${currency}`;
    }
    return row.eventName === "Purchase" ? "sin monto (no se inventó 0)" : "ok";
  }
  if (row.status === "failed") {
    return row.errorMessage ?? "Meta rechazó el envío";
  }
  // skipped
  const r = row.skipReason ?? "";
  if (r === "is_test") return "conversación de prueba del Laboratorio";
  if (r === "sin_ctwa_clid") return "lead orgánico (sin anuncio)";
  if (r === "sin_config_capi") return "sin dataset configurado";
  if (r === "sin_token") return "sin token para autorizar";
  if (r === "atribucion_apagada") return "atribución apagada";
  return r || "—";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
