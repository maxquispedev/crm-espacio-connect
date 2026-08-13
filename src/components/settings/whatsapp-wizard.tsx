"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseEmbeddedSignupMessage } from "@/lib/meta/embedded-signup";
import { loadFacebookSdk } from "@/lib/meta/facebook-sdk";

type Connection = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type EmbeddedSignupConfig = {
  appId: string | null;
  configId: string | null;
  graphVersion: string;
};

type WebhookInfo = {
  url: string;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

type SessionIds = { wabaId: string; phoneNumberId: string };

export function WhatsappWizard() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [signup, setSignup] = useState<EmbeddedSignupConfig | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) {
      setConnection(c.connection ?? null);
      if (c.embeddedSignup) setSignup(c.embeddedSignup);
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token de WhatsApp expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos están pausados. Vuelve a conectar con Meta.
            </p>
          </div>
        </div>
      )}

      {connection && connection.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-border bg-success-soft p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Número conectado: {connection.displayPhoneNumber ?? connection.phoneNumberId}
            </p>
            <p className="text-success-text opacity-80">
              {connection.verifiedName ? `${connection.verifiedName} · ` : ""}
              token …{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Conectado</Badge>
        </div>
      )}

      <EmbeddedSignupCard
        config={signup}
        existing={connection}
        onSaved={() => void refetch()}
      />

      {webhook && <WebhookCard webhook={webhook} />}

      <details className="rounded-lg border bg-card text-sm">
        <summary className="cursor-pointer px-5 py-3 font-medium text-muted-foreground">
          Conexión manual (operaciones)
        </summary>
        <div className="border-t px-5 py-4">
          <ConnectForm existing={connection} onSaved={() => void refetch()} />
        </div>
      </details>
    </div>
  );
}

function EmbeddedSignupCard({
  config,
  existing,
  onSaved,
}: {
  config: EmbeddedSignupConfig | null;
  existing: Connection | null;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idsRef = useRef<SessionIds | null>(null);
  const idsWaiters = useRef<Array<(ids: SessionIds) => void>>([]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const parsed = parseEmbeddedSignupMessage(event.origin, event.data);
      if (!parsed) return;
      if (parsed.event === "CANCEL" || parsed.event === "ERROR") return;
      if (!parsed.wabaId || !parsed.phoneNumberId) return;
      const ids = { wabaId: parsed.wabaId, phoneNumberId: parsed.phoneNumberId };
      idsRef.current = ids;
      for (const wait of idsWaiters.current) wait(ids);
      idsWaiters.current = [];
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function waitForIds(timeoutMs: number): Promise<SessionIds> {
    if (idsRef.current) return Promise.resolve(idsRef.current);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        idsWaiters.current = idsWaiters.current.filter((w) => w !== onIds);
        reject(new Error("timeout"));
      }, timeoutMs);
      function onIds(ids: SessionIds) {
        clearTimeout(timer);
        resolve(ids);
      }
      idsWaiters.current.push(onIds);
    });
  }

  async function connect() {
    setError(null);
    if (!config?.appId || !config.configId) {
      setError(
        "Falta META_APP_ID o META_EMBEDDED_SIGNUP_CONFIG_ID en el servidor."
      );
      return;
    }

    setBusy(true);
    idsRef.current = null;
    try {
      const FB = await loadFacebookSdk();
      FB.init({
        appId: config.appId,
        cookie: true,
        xfbml: false,
        version: config.graphVersion,
      });

      const login = await new Promise<{
        status?: string;
        code?: string;
      }>((resolve) => {
        FB.login(
          (response) => {
            resolve({
              status: response.status,
              code: response.authResponse?.code,
            });
          },
          {
            config_id: config.configId,
            response_type: "code",
            override_default_response_type: true,
            extras: {
              setup: {},
              featureType: "whatsapp_business_app_onboarding",
              sessionInfoVersion: "3",
            },
          }
        );
      });

      if (!login.code) {
        if (login.status === "unknown") {
          setError("Se cerró la ventana de Meta sin completar la conexión.");
        } else {
          setError("Conexión cancelada. Puedes intentarlo de nuevo cuando quieras.");
        }
        return;
      }

      let ids: SessionIds;
      try {
        ids = await waitForIds(15_000);
      } catch {
        setError(
          "Meta no envió el WABA o el número. Cierra el popup e intenta de nuevo."
        );
        return;
      }

      const res = await fetch("/api/settings/whatsapp/embedded-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: login.code,
          wabaId: ids.wabaId,
          phoneNumberId: ids.phoneNumberId,
        }),
      }).catch(() => null);

      if (!res) {
        setError("Sin conexión con el servidor");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(data?.error?.message ?? "No se pudo completar la conexión");
        return;
      }
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo abrir Embedded Signup"
      );
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(config?.appId && config.configId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing ? "Reconectar WhatsApp" : "Conectar tu WhatsApp"}
        </CardTitle>
        <CardDescription>
          Conecta el número que ya usas en WhatsApp Business App. Meta mostrará
          un QR de Coexistencia: el teléfono sigue en la app móvil y Espacio
          Connect recibe los mensajes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured && (
          <p className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Embedded Signup no está configurado (App ID / Configuration ID).
            Un operador debe completar las variables en el servidor.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button disabled={!configured || busy} onClick={() => void connect()}>
          {busy ? "Conectando…" : "Conectar con Meta"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ConnectForm({
  existing,
  onSaved,
}: {
  existing: Connection | null;
  onSaved: () => void;
}) {
  const [wabaId, setWabaId] = useState(existing?.wabaId ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    existing?.phoneNumberId ?? ""
  );
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<
    | { ok: true; display: string }
    | { ok: false; message: string }
    | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canTest = wabaId.trim() && phoneNumberId.trim() && token.trim();

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId, token }),
    }).catch(() => null);
    setTesting(false);
    if (!res) {
      setTestResult({ ok: false, message: "Sin conexión con el servidor" });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && data?.displayPhoneNumber) {
      setTestResult({ ok: true, display: data.displayPhoneNumber });
    } else {
      setTestResult({
        ok: false,
        message: data?.error?.message ?? "La validación falló",
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId, phoneNumberId, token }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSaveError(data?.error?.message ?? "No se pudo guardar la conexión");
      return;
    }
    setToken("");
    setTestResult(null);
    onSaved();
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Solo para operaciones. El cliente debe usar Conectar con Meta.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="waba-id">WABA ID</Label>
          <Input
            id="waba-id"
            placeholder="ID de la cuenta de WhatsApp Business"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone-number-id">Phone Number ID</Label>
          <Input
            id="phone-number-id"
            placeholder="ID del número de teléfono"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="token">Token de acceso</Label>
        <Input
          id="token"
          type="password"
          placeholder={
            existing
              ? `Guardado (…${existing.tokenLast4}) — pega uno nuevo para cambiarlo`
              : "EAAG…"
          }
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setTestResult(null);
          }}
        />
      </div>

      {testResult && (
        <p
          className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
        >
          {testResult.ok
            ? `✓ Token válido para ${testResult.display}. Ya puedes guardar.`
            : testResult.message}
        </p>
      )}
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!canTest || testing}
          onClick={() => void test()}
        >
          {testing ? "Probando…" : "Probar conexión"}
        </Button>
        <Button
          disabled={!testResult?.ok || saving}
          onClick={() => void save()}
        >
          {saving ? "Guardando…" : "Guardar conexión"}
        </Button>
      </div>
    </div>
  );
}

function WebhookCard({ webhook }: { webhook: WebhookInfo }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook de WhatsApp</CardTitle>
        <CardDescription>
          Diagnóstico de la instancia. Todas las organizaciones envían eventos
          a esta misma URL; Embedded Signup suscribe la WABA automáticamente
          (no hay que pegar el webhook en Meta ni usar override).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La URL configurada no es https: Meta exige https para los webhooks.
            Ajusta APP_BASE_URL con tu dominio público.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>URL del webhook (callback URL)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar URL"
              onClick={() => copy(webhook.url, "url")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "url" && (
              <span className="text-xs text-brand-text">Copiada ✓</span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Verify token</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.verifyToken}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar verify token"
              onClick={() => copy(webhook.verifyToken, "vt")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "vt" && (
              <span className="text-xs text-brand-text">Copiado ✓</span>
            )}
          </div>
        </div>
        {webhook.signatureLayer ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> Verificación de firma activa
            (META_APP_SECRET configurado): cada evento se valida con
            x-hub-signature-256.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> Sin App Secret
            configurado: el webhook queda protegido por la URL secreta. Para la
            capa extra de firma, agrega META_APP_SECRET a la instancia.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
