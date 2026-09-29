<!--
SYNC IMPACT REPORT
==================
Este plan NO modifica la constitución ni las plantillas.
NO reabre el spec 003 cerrado. Reutiliza sendMediaMessage y el endpoint existente.
-->

# Implementation Plan: UX de mensajería del inbox — cola de adjuntos (004-inbox-messaging-ux)

**Branch**: `feat/004-inbox-messaging-ux`
**Date**: 2026-09-29
**Spec**: [spec.md](./spec.md)
**Status**: Draft

## Summary

Mejorar la UX del composer del inbox (cola visual, drag & drop, paste, previews por tipo, estados por adjunto, video grande como documento) **sin tocar el backend**. Se introduce:

1. Un nuevo modelo de estado local (`PendingAttachment[]`) en el composer.
2. Dos componentes presentacionales nuevos (`AttachmentQueue`, `AttachmentItem`) con sus estilos.
3. Helpers nuevos (`classifyForQueue`, `formatAttachStatus`) en `src/components/inbox/helpers.ts`.
4. Manejo de eventos de drag/drop y paste en el wrapper derecho del inbox.
5. Una función `submitQueue` que itera el endpoint existente `/api/conversations/:id/messages/media` con `await`, anti-doble-envío y reintento por adjunto.

Cero cambios de schema, cero nuevos endpoints, cero nuevas dependencias npm, cero cambios en `sendMediaMessage` o `media.ts`.

## Technical Context

**Lenguaje / Versión**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), React 19, Next.js 15 App Router.

**Frontend (este spec) — único lado modificado**:
- `src/components/inbox/composer.tsx` — refactor interno del bloque de adjuntos. Mantiene la API pública (`onSend`, `onSent`, `conversation`).
- `src/components/inbox/attachment-queue.tsx` — NUEVO. Renderiza la fila horizontal de tarjetas + el overlay de drop.
- `src/components/inbox/attachment-item.tsx` — NUEVO. Una tarjeta (preview + nombre + tamaño + estado + acciones).
- `src/components/inbox/inbox-client.tsx` — pequeño cambio: pasar handler de drop al wrapper del panel derecho (opcional, ver §Diseño).
- `src/components/inbox/helpers.ts` — añadir `classifyForQueue`, `formatAttachStatus`, `humanAttachType`.
- `src/components/inbox/__tests__/attachment-queue.test.tsx` — NUEVO. Tests unit del modelo de cola y helpers.

**Backend / Persistencia / Infraestructura**: ningún cambio. Reutilizamos `sendMediaMessage` y el endpoint existente tal cual.

**Testing**: Vitest para la lógica de cola y helpers. Self-test E2E (`scripts/e2e-selftest.mjs`) — sección 009 nueva para validar el contrato que la cola asume. Guion Playwright manual en `tests/e2e/009-inbox-messaging-ux.md`.

**Plataforma objetivo**: web (desktop + responsive). Sin móvil nativo.

**Performance**: la cola es liviana (decenas de tarjetas con `<img>`/`<video>` `preload="metadata"`). El envío es por el endpoint actual. Sin objetivo de rendimiento duro medible.

**Escala**: misma que la actual (un operador por conversación).

## Constitution Check (pre-Phase 0)

| Principio | Aplicación en este spec | Estado |
|---|---|---|
| **I — Seguridad de datos primero** | No se introducen secretos; el cambio de MIME a `application/octet-stream` se hace client-side con un `File` nuevo (no se reenvía token de WhatsApp; el `Authorization: Bearer` ya está en `uploadGraphMedia` server-side). | ✅ |
| **II — Soberanía / Self-Hosted** | Cero nuevas dependencias. Cero S3/R2/email/Stripe. El "video como documento" es lógica cliente pura (no requiere proveedor externo). | ✅ |
| **III — Multi-tenancy real** | No tocamos schema. La cola es estado local. El endpoint sigue exigiendo `organization_id` (no se modifica). | ✅ |
| **IV — Idempotencia en integraciones externas** | No tocamos webhook. Cada llamada a `/media` crea un nuevo `media_asset` y `message`; un fallo del segundo no re-envía el primero. | ✅ |
| **V — Calidad verificable** | Tests unit + E2E con mocks + manual con Playwright. | ✅ |
| **VI — Specs antes de código** | Este spec es el primero de la feature. Implementación viene en commits posteriores. | ✅ |
| **VII — Trazabilidad de decisiones** | Decisiones clave explícitas en `spec.md` §Resumen y en este plan §Decisiones. | ✅ |
| **VIII — Foco vertical** | Mejora del inbox, el producto. No broadcast, no scraping, no billing. | ✅ |
| **IX — Verificación en vivo** | Self-test E2E con reglas duras (allowlist, sin ráfaga, volumen mínimo) + Playwright manual. | ✅ |

**Resultado**: sin violaciones. No hace falta Complexity Tracking.

## Project Structure

```
specs/004-inbox-messaging-ux/
├── spec.md                     (este PR)
├── plan.md                     (este archivo)
├── tasks.md                    (este PR)
└── e2e.md                      (no en este PR — se crea durante el commit de implementación)

src/components/inbox/
├── composer.tsx                (modificado en commit 3)
├── attachment-queue.tsx        (NUEVO commit 2)
├── attachment-item.tsx         (NUEVO commit 2)
├── helpers.ts                  (modificado commit 2: classifyForQueue, formatAttachStatus, humanAttachType)
├── inbox-client.tsx            (modificado commit 3: drop zone opcional en panel derecho)
├── message-thread.tsx          (sin cambios)
├── contact-panel.tsx           (sin cambios)
├── conversation-list.tsx       (sin cambios)
├── template-sender.tsx         (sin cambios)
└── __tests__/
    └── attachment-queue.test.tsx   (NUEVO commit 2 + commit 3)

scripts/e2e-selftest.mjs        (modificado commit 3: sección 009)
tests/e2e/009-inbox-messaging-ux.md (NUEVO commit 3)
```

## Diseño

### 1. Modelo de cola (cliente, ephemeral)

```typescript
// src/components/inbox/attachment-queue.tsx (exportado para tests)
export type AttachStatus = "pending" | "sending" | "sent" | "failed";

export type PendingAttachment = {
  /** id local (nanoid prefix "att_"); nunca se persiste ni se envía. */
  id: string;
  file: File;
  /** Object URL para <img>/<video>/<audio>; null para documentos. Revocado en remove/sent/unmount. */
  previewUrl: string | null;
  /** kind efectivo que se enviará (puede diferir del kind del MIME original). */
  kind: "image" | "audio" | "video" | "document";
  /** MIME que se enviará al servidor (ajustado si willSendAsDocument). */
  effectiveMime: string;
  /** true si el original era video >16MB forzado a documento. */
  willSendAsDocument: boolean;
  status: AttachStatus;
  error: string | null;
};
```

### 2. Helpers nuevos (`helpers.ts`)

```typescript
const VIDEO_MAX_AS_VIDEO = 16 * 1024 * 1024;
const DOC_MAX = 100 * 1024 * 1024;

/** Decide kind, MIME efectivo y willSendAsDocument antes de añadir a la cola. */
export function classifyForQueue(file: File): {
  kind: PendingAttachment["kind"];
  effectiveMime: string;
  willSendAsDocument: boolean;
} { ... }

/** Etiqueta humana del estado para a11y y para el aria-label. */
export function formatAttachStatus(s: AttachStatus): string { ... }

/** Etiqueta humana del tipo de adjunto (imagen, video, audio, documento). */
export function humanAttachType(k: PendingAttachment["kind"]): string { ... }
```

Reglas de `classifyForQueue` (no sustituye al servidor; solo decide el "shape" del envío):

| MIME original | Tamaño | Resultado |
|---|---|---|
| `image/*` reconocido | ≤ 5 MB | `kind="image"`, `effectiveMime=file.type`, `willSendAsDocument=false` |
| `audio/*` reconocido | ≤ 16 MB | `kind="audio"`, `effectiveMime=file.type`, `willSendAsDocument=false` |
| `video/*` reconocido | ≤ 16 MB | `kind="video"`, `effectiveMime=file.type`, `willSendAsDocument=false` |
| `video/*` reconocido | > 16 MB y ≤ 100 MB | `kind="document"`, `effectiveMime="application/octet-stream"`, `willSendAsDocument=true` |
| `*/*` (no image/audio/video) | ≤ 100 MB | `kind="document"`, `effectiveMime=file.type \|\| "application/octet-stream"`, `willSendAsDocument=false` |
| cualquiera | > 100 MB | retorna `null` → cliente no añade a la cola y muestra toast |

(La clasificación exacta del servidor sigue en `kindFromMime` / `validateOutgoing`; no se duplica la lógica dura, solo la decisión de "enviar como documento".)

### 3. Componentes

#### `attachment-item.tsx`

Presentacional. Props: `attachment: PendingAttachment`, `onRemove(id)`, `onRetry(id)`.

- Renderiza el preview según `kind` (ver spec §FR-5).
- Muestra nombre truncado (`truncate`) + tamaño (`formatBytes`).
- Indicador de estado:
  - `pending` → esquina superior derecha: spinner pequeño (no bloqueante).
  - `sending` → spinner + opacity reducida.
  - `sent` → check verde (lucide `Check`).
  - `failed` → borde rojo + triángulo `AlertTriangle` + texto del error debajo + botón Reintentar (lucide `RotateCcw`).
- Botón X (lucide `X`) siempre visible si `status === "pending"` o `=== "failed"` (reintentar reemplaza a X en failed, opción 1; o X + Reintentar visibles a la vez, opción 2 — decidir en implementación; opción 1 es más limpio, opción 2 más descubrible).
- `aria-label` dinámico.

#### `attachment-queue.tsx`

Props: `attachments: PendingAttachment[]`, `onRemove`, `onRetry`, `children` (slot para el composer).

- Renderiza la fila horizontal (`flex flex-nowrap overflow-x-auto gap-2`) de `AttachmentItem`.
- Cleanup de Object URLs en `useEffect` cleanup al desmontar.
- `aria-live="polite"` en el contenedor.
- Exporta `useAttachmentQueue(initial?: PendingAttachment[])` con helpers `addFiles(File[]): { accepted: number; rejected: { file: File; reason: string }[] }`, `remove(id)`, `retry(id)`, `clearSent()`, etc.

#### `composer.tsx` (modificado)

- Reemplaza el `useState<File | null>` por el modelo de cola.
- `submit()` se ramifica:
  - Si la cola está vacía → envía texto (comportamiento actual intacto).
  - Si la cola tiene adjuntos → llama `submitQueue(text)`.
- `submitQueue(text)`:
  ```typescript
  async function submitQueue(caption: string) {
    if (submitInFlight.current) return; // anti-doble-envío
    submitInFlight.current = true;
    setSending(true);
    try {
      let firstWithCaption = true;
      for (const att of attachments) {
        if (att.status === "sent") continue;
        updateStatus(att.id, "sending");
        try {
          const form = new FormData();
          const fileToSend = new File([att.file], att.file.name, { type: att.effectiveMime });
          form.set("file", fileToSend);
          if (firstWithCaption && caption.trim()) {
            form.set("caption", caption.trim().slice(0, 1024));
            firstWithCaption = false;
          }
          const res = await fetch(`/api/conversations/${conversation.id}/messages/media`, {
            method: "POST", body: form,
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(data?.error?.message ?? `Error ${res.status}`);
          }
          updateStatus(att.id, "sent");
          revokeIfUrl(att);
        } catch (err) {
          updateStatus(att.id, "failed", (err as Error).message);
        }
      }
      // Si todo salió bien, limpia el texto.
      if (attachments.every((a) => a.status === "sent")) {
        setText("");
        if (taRef.current) taRef.current.style.height = "auto";
      }
    } finally {
      submitInFlight.current = false;
      setSending(false);
      onSent();
    }
  }
  ```

### 4. Drag & drop y paste

#### Dropzone

El wrapper derecho (donde están `MessageThread` + `Composer`) recibe `onDragOver` / `onDragEnter` / `onDragLeave` / `onDrop`. Mientras `dragOver`, se muestra un overlay absolute con borde dashed y texto "Suelta para adjuntar archivos".

```typescript
function DropZone({ children }: { children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const counter = useRef(0);
  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        counter.current += 1;
        if (e.dataTransfer.types.includes("Files")) setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault(); // necesario para permitir drop
      }}
      onDragLeave={() => {
        counter.current = Math.max(0, counter.current - 1);
        if (counter.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        counter.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        addFiles(files);
      }}
      className="relative flex min-h-0 flex-1 flex-col"
      role="region"
      aria-label="Área de conversación; arrastra archivos para adjuntar"
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-brand bg-brand/10">
          <p className="rounded-md bg-background px-3 py-2 text-sm font-medium">
            Suelta para adjuntar archivos
          </p>
        </div>
      )}
    </div>
  );
}
```

El `counter` con `useRef` evita parpadeo cuando el cursor cruza sub-elementos.

#### Paste

En el `<textarea>` (más limpio que en el wrapper):

```typescript
onPaste={(e) => {
  const items = Array.from(e.clipboardData?.items ?? []);
  const files = items
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter((f): f is File => Boolean(f));
  if (files.length > 0) {
    e.preventDefault(); // evitamos que el pegado inserte el binario en el textarea
    addFiles(files);
  }
  // Si no hay archivos, dejamos el pegado pasar normalmente (texto).
}}
```

### 5. Anti doble-envío

- `submitInFlight = useRef(false)` — cortocircuito antes de iniciar otro loop.
- `disabled={sending || (queue vacío && !text)}` en el botón Enviar.
- `disabled` también durante la animación de spinner de cualquier tarjeta `sending`.

### 6. Cleanup de Object URLs

```typescript
// En useAttachmentQueue
useEffect(() => {
  return () => {
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
  };
}, []); // mount/unmount only — el resto se gestiona en remove/sent

function remove(id: string) {
  const att = attachments.find((a) => a.id === id);
  if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
  setAttachments((prev) => prev.filter((a) => a.id !== id));
}
```

### 7. Pre-validación cliente (soft)

```typescript
function addFiles(files: File[]) {
  const accepted: PendingAttachment[] = [];
  const rejected: { file: File; reason: string }[] = [];
  for (const file of files) {
    const classified = classifyForQueue(file);
    if (!classified) {
      rejected.push({ file, reason: "Excede 100 MB o tipo no soportado" });
      continue;
    }
    accepted.push({
      id: `att_${nanoid()}`,
      file,
      previewUrl: makePreviewUrl(file),
      ...classified,
      status: "pending",
      error: null,
    });
  }
  // Mostrar `rejected` como toast inline.
  if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
  return { accepted: accepted.length, rejected };
}
```

Esto NO sustituye al servidor. Si el cliente no detecta un problema y el servidor sí (p. ej. sandbox), el adjunto falla con el motivo del servidor y el operador puede reintentar o ajustar.

### 8. A11y

- Dropzone: `role="region"` + `aria-label` + `aria-live="polite"`.
- Cola: `role="list"`.
- Cada tarjeta: `role="listitem"` con `aria-label` construido como `"Adjuntar {humanType}, {filename}, {formatBytes(size)}, {formatAttachStatus(status)}"`.
- Botones: `aria-label="Quitar adjunto"` y `"Reintentar envío de {filename}"`.
- Foco visible (Tailwind `focus-visible:ring-2 focus-visible:ring-brand`).

### 9. Responsive

- Cola: `flex flex-nowrap gap-2 overflow-x-auto pb-1` (scroll horizontal, padding inferior para que la barra no tape la última tarjeta).
- Tarjeta base: `min-w-[100px] max-w-[140px]`.
- Botones X y Retry: `min-h-[44px] min-w-[44px] p-2.5` (touch target).
- En viewports < 640 px, ocultar el nombre y dejar solo icono + tamaño (opcional, decidir en implementación).

### 10. Camino infeliz explícito

| Escenario | Comportamiento esperado |
|---|---|
| Video de 120 MB arrastrado | Toast "Excede 100 MB", NO se añade a la cola. |
| `image/bmp` de 4 MB | `kind="document"` (igual que la app de WhatsApp, ya clasifica en server). Preview = tarjeta de documento. |
| Cola de 5 adjuntos, segundo falla 413 | Primero `sent`, segundo `failed` con mensaje del servidor, los otros 3 se procesan. |
| Ventana se cierra durante envío | Adjuntos restantes fallan con `window_closed`; los enviados mantienen estado. |
| Conexión perdida con el servidor | Cada fetch devuelve error genérico; cada adjunto queda `failed` con "Sin conexión con el servidor". |
| `is_test` (sandbox) | El endpoint devuelve 403 `sandbox_violation`; cada adjunto queda `failed` con ese mensaje; ningún asset en disco. |
| Cambio de conversación con cola activa | Cola se descarta (refs cleanup) y Object URLs se revocan. El operador debe re-queuear al volver. |

## Decisiones explícitas

1. **No se crea endpoint batch**: el endpoint actual es idempotente por construcción (cada llamada crea un `media_asset` único). Un batch complicaría el manejo de partial-failure sin beneficio observable. Si en el futuro la cola crece a docenas, se re-evalúa.
2. **Caption solo en el primer adjunto**: alineado con WhatsApp Web. El servidor ya descarta caption para `audio` (`if (input.caption && kind !== "audio")`).
3. **"Video como documento" se decide en cliente, sin tocar el servidor**: el servidor sigue siendo la fuente de verdad (rechaza video > 16 MB). El cliente "esquiva" el límite re-tagging como document; el operador ve claramente el aviso. Esto evita amending `validateOutgoing` y mantiene la constitución.
4. **No se agrega barra de progreso de envío**: el feedback por adjunto es suficiente. El endpoint no expone progreso granular y agregarlo sería scope creep.
5. **No se reescribe el composer entero**: solo la rama de adjuntos. El textarea, location, contact y templates siguen como están. La API pública del componente (`Composer`) no cambia.
6. **El "anti doble-envío" combina dos capas**: `disabled` en el botón (capa visual) + `useRef` de in-flight (capa lógica). Ninguna de las dos sola es suficiente ante clicks programáticos.
7. **Cola NO persiste entre conversaciones**: estado ephemeral por diseño. Si en el futuro hace falta persistencia, se reabre como spec.

## Complexity Tracking

| Violación | Por qué se necesita | Alternativa rechazada |
|---|---|---|
| (ninguna) | — | — |

## Próximo paso

Abrir `tasks.md` con el detalle dependency-ordered de los 3 commits.