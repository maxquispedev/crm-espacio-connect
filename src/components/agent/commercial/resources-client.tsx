"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CommercialResourcesDto, VideoResourceDto } from "@/lib/commercial/dto";
import type { DemoResourceSlot, PaymentInstructions } from "@/lib/commercial/resources";

export async function readResourceError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch { return `${fallback} (HTTP ${response.status})`; }
}

const LABELS: Record<DemoResourceSlot, string> = {
  demo_enrollment_panel: "Matrícula y panel",
  demo_payments_balances: "Pagos y saldos",
  demo_online_enrollment: "Matrícula online",
};
export type PaymentForm = {
  transfers: Array<{ bank: string; holder: string; currency: "PEN" | "USD"; accountNumber: string; cci: string }>;
  yapePhone: string;
  yapeHolder: string;
  paymentLink: string;
};
export function paymentFormOf(value: PaymentInstructions): PaymentForm {
  return { transfers: value.transfers.map((t) => ({ ...t, accountNumber: t.accountNumber ?? "", cci: t.cci ?? "" })),
    yapePhone: value.yape?.phone ?? "", yapeHolder: value.yape?.holder ?? "", paymentLink: value.paymentLink ?? "" };
}
/** Solo ausencia → null/omitido; datos parciales viajan al servidor y se rechazan. */
export function paymentPayloadOf(form: PaymentForm): PaymentInstructions {
  return {
    transfers: form.transfers.map(({ accountNumber, cci, ...t }) => ({ ...t,
      ...(accountNumber.trim() ? { accountNumber } : {}), ...(cci.trim() ? { cci } : {}) })),
    yape: form.yapePhone.trim() || form.yapeHolder.trim()
      ? { phone: form.yapePhone, holder: form.yapeHolder } : null,
    paymentLink: form.paymentLink.trim() || null,
  };
}

export function VideoResourceRow({ video, busy, onUpload }: {
  video: VideoResourceDto; busy: boolean; onUpload: (slot: DemoResourceSlot, file: File) => void;
}) {
  return <div data-resource-slot={video.slot} className="space-y-2 rounded-md border p-3">
    <h4 className="text-sm font-medium">{LABELS[video.slot]}</h4>
    <p className="text-xs text-muted-foreground">{video.configured ? "Configurado" : "Sin configurar"}</p>
    {video.media && <>
      <p className="break-all text-xs">{video.media.fileName} · {(video.media.fileSize / 1024 / 1024).toFixed(2)} MiB</p>
      <video controls preload="metadata" src={video.media.previewUrl} className="max-h-48 w-full" aria-label={`Preview ${LABELS[video.slot]}`} />
    </>}
    <label className="block text-sm">
      {video.configured ? "Reemplazar MP4" : "Subir MP4"}
      <input aria-label={`MP4 ${LABELS[video.slot]}`} type="file" accept="video/mp4,.mp4" disabled={busy}
        className="mt-1 block w-full text-xs"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onUpload(video.slot, file);
        }} />
    </label>
  </div>;
}

export function PaymentFields({ form, busy, onChange, onSave }: {
  form: PaymentForm; busy: boolean; onChange: (form: PaymentForm) => void; onSave: () => void;
}) {
  const field = (id: string, label: string, value: string, change: (value: string) => void, maxLength = 120) =>
    <label className="block space-y-1 text-sm" key={id} htmlFor={id}>{label}
      <Input id={id} value={value} maxLength={maxLength} onChange={(event) => change(event.target.value)} />
    </label>;
  return <form onSubmit={(event) => { event.preventDefault(); onSave(); }} className="space-y-3">
    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Recursos de cobro</legend>
      <p className="text-xs text-muted-foreground">Hasta cinco transferencias, Yape y link HTTPS opcionales. Guarda los cambios de cobro explícitamente.</p>
      {form.transfers.map((transfer, index) => {
        const update = (patch: Partial<typeof transfer>) => onChange({ ...form,
          transfers: form.transfers.map((t, i) => i === index ? { ...t, ...patch } : t) });
        return <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
          {field(`bank-${index}`, `Banco ${index + 1}`, transfer.bank, (bank) => update({ bank }))}
          {field(`holder-${index}`, `Titular ${index + 1}`, transfer.holder, (holder) => update({ holder }))}
          <label className="space-y-1 text-sm" htmlFor={`currency-${index}`}>Moneda {index + 1}
            <select id={`currency-${index}`} className="block h-9 w-full rounded-md border bg-transparent px-3" value={transfer.currency}
              onChange={(event) => update({ currency: event.target.value as "PEN" | "USD" })}>
              <option value="PEN">PEN</option><option value="USD">USD</option>
            </select>
          </label>
          {field(`account-${index}`, `Cuenta ${index + 1}`, transfer.accountNumber, (accountNumber) => update({ accountNumber }), 40)}
          {field(`cci-${index}`, `CCI ${index + 1}`, transfer.cci, (cci) => update({ cci }), 40)}
          <Button type="button" variant="ghost" onClick={() => onChange({ ...form, transfers: form.transfers.filter((_, i) => i !== index) })}>Quitar transferencia {index + 1}</Button>
        </div>;
      })}
      <Button type="button" variant="outline" disabled={form.transfers.length >= 5} onClick={() => onChange({ ...form,
        transfers: [...form.transfers, { bank: "", holder: "", currency: "PEN", accountNumber: "", cci: "" }] })}>Añadir transferencia</Button>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("yape-phone", "Teléfono Yape", form.yapePhone, (yapePhone) => onChange({ ...form, yapePhone }), 20)}
        {field("yape-holder", "Titular Yape", form.yapeHolder, (yapeHolder) => onChange({ ...form, yapeHolder }))}
      </div>
      {field("payment-link", "Link de pago HTTPS", form.paymentLink, (paymentLink) => onChange({ ...form, paymentLink }), 2048)}
      <Button type="submit">{busy ? "Procesando…" : "Guardar cobro"}</Button>
    </fieldset>
  </form>;
}

export function CommercialResourcesClient() {
  const [data, setData] = useState<CommercialResourcesDto | null>(null);
  const [form, setForm] = useState<PaymentForm | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/commercial-resources", { cache: "no-store" });
        if (!res.ok) throw new Error(await readResourceError(res, "No se pudieron cargar los recursos"));
        const result = await res.json() as CommercialResourcesDto;
        if (active) { setData(result); setForm(paymentFormOf(result.paymentInstructions)); setNotice(null); }
      } catch (error) {
        if (active) setNotice({ error: true, text: error instanceof Error ? error.message : "No se pudieron cargar los recursos" });
      }
    }
    void load();
    return () => { active = false; };
  }, [retry]);

  async function mutate(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice(null);
    try { await action(); }
    catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "No se pudieron guardar los recursos" }); }
    finally { lock.current = false; setBusy(false); }
  }

  function upload(slot: DemoResourceSlot, file: File) {
    void mutate(async () => {
      const body = new FormData(); body.set("file", file);
      const res = await fetch(`/api/commercial-resources/videos/${slot}`, { method: "PUT", body });
      if (!res.ok) throw new Error(await readResourceError(res, "No se pudo guardar el MP4"));
      const video = await res.json() as VideoResourceDto;
      setData((previous) => previous && { ...previous, videos: previous.videos.map((v) => v.slot === slot ? video : v) });
      setNotice({ error: false, text: "Video guardado" });
    });
  }

  function savePayment() {
    if (!form) return;
    void mutate(async () => {
      const res = await fetch("/api/commercial-resources", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentInstructions: paymentPayloadOf(form) }) });
      if (!res.ok) throw new Error(await readResourceError(res, "No se pudo guardar el cobro"));
      const result = await res.json() as Pick<CommercialResourcesDto, "paymentInstructions">;
      setData((previous) => previous && { ...previous, ...result });
      setForm(paymentFormOf(result.paymentInstructions));
      setNotice({ error: false, text: "Cobro guardado" });
    });
  }

  return <Card>
    <CardHeader><CardTitle>Recursos comerciales</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-xs text-muted-foreground">MP4 hasta 16 MiB. La subida guarda el archivo localmente. Si Meta rechaza el codec al enviarlo, prepara un MP4 compatible.</p>
      {notice && <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-sm text-danger-text" : "text-sm text-success-text"}>{notice.text}</p>}
      {!data ? <>
        {!notice && <p role="status">Cargando recursos…</p>}
        {notice && <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>Reintentar carga de recursos</Button>}
      </> : <>
        <div className="grid gap-3 lg:grid-cols-3">{data.videos.map((video) => <VideoResourceRow key={video.slot} video={video} busy={busy} onUpload={upload} />)}</div>
        {form && <PaymentFields form={form} busy={busy} onChange={setForm} onSave={savePayment} />}
      </>}
    </CardContent>
  </Card>;
}
