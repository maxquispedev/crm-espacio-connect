<!--
SYNC IMPACT REPORT
==================
Este plan NO modifica la constitución ni las plantillas.
NO reabre ningún spec cerrado. NO introduce schema nuevo.
Reutiliza PATCH /api/contacts/:id ya existente y scoped().
-->

# Implementation Plan: Edición rápida del nombre del lead desde el panel del inbox (005-quick-lead-name)

**Branch**: `feat/005-quick-lead-name`
**Date**: 2026-09-29
**Spec**: [spec.md](./spec.md)
**Status**: Draft

## Summary

Añadir edición inline de `contact.name` en la cabecera del `ContactPanel`
(panel lateral derecho del inbox), con sincronización inmediata del nombre
en los tres lugares que lo muestran (panel, header del hilo, lista izquierda)
sin recargar la página y sin esperar a SSE.

**Cambios totales (cliente solamente):**

1. Una **helper pura testeable** `applyContactNamePatch(conversations, update)`
   en `src/components/inbox/conversation-list.tsx` (o nuevo módulo
   `inbox/state-helpers.ts`) — sin React, fácil de cubrir con tests unit.
2. **Inline edit microcomponente** en `src/components/inbox/contact-panel.tsx`:
   un estado local `{ mode: "view" | "edit" }` + draft + saving + error.
3. **Nueva prop** `onContactUpdated` en `ContactPanel`, llamada tras 200 del
   PATCH. `InboxClient` la conecta con `setConversations(prev => ...)` usando
   la helper pura.
4. **Forzar re-mount de `ContactPanel`** con `key={selected.contact.id}` en
   `inbox-client.tsx` para descartar el estado de edición al cambiar de
   conversación.
5. **Sección E2E** `tests/e2e/010-quick-lead-name.md` guionada y agregada al
   `scripts/e2e-selftest.mjs` (o como manual Playwright si la automatización
   es costosa).

Cero cambios de schema, cero endpoints nuevos, cero nuevas dependencias npm,
cero cambios en el sender, el webhook, el endpoint PATCH o cualquier módulo
backend.

## Technical Context

**Lenguaje / Versión**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), React 19, Next.js 15 App Router.

**Frontend (único lado modificado)**:

- `src/components/inbox/contact-panel.tsx` — añadir estado local de edición,
  swap del `<p>` por `<input>` + botones, llamada al PATCH.
- `src/components/inbox/inbox-client.tsx` — añadir `key={selected.contact.id}`
  y handler `onContactUpdated` que aplica la helper pura a `conversations`.
- `src/components/inbox/conversation-list.tsx` — sin cambios funcionales
  (consume `c.contact.name` que ya se actualizará por el re-render).
- `src/components/inbox/helpers.ts` — opcionalmente una `clampName(raw)`
  pura para trim+longitud cliente (UX).

**Nuevo helper testeable (puro, sin React)**:

- `src/components/inbox/conversation-patch.ts` (NUEVO) — exporta
  `applyContactNamePatch(conversations: ConversationDto[], update: { id: string; name: string }): ConversationDto[]`.
  Inmutable: retorna array nuevo. Si el id no aparece, retorna el array
  original sin cambios. Solo reemplaza `contact.name` cuando
  `contact.id === update.id`.

**Backend / Persistencia / Infraestructura**: ningún cambio. Reutilizamos
`PATCH /api/contacts/:id` y `serializeContact` tal cual.

**Testing**: Vitest para la helper pura. Self-test E2E con mocks (donde
aplique) y guion Playwright manual en `tests/e2e/010-quick-lead-name.md`.

**Plataforma objetivo**: web (desktop). Sin móvil nativo.

**Performance**: trivial. PATCH ≤ 1 KB body. Re-render del array de
conversaciones ≤ unos cientos de elementos.

## Constitution Check (pre-Phase 0)

| Principio | Aplicación en este spec | Estado |
|---|---|---|
| **I — Seguridad de datos primero** | El PATCH ya viaja bajo la sesión Better Auth; no se exponen secretos; no se loguea el nombre (no es secreto pero igual se evita). | ✅ |
| **II — Soberanía / Self-Hosted** | Cero nuevas dependencias. Cero S3/R2/email/Stripe. Reutiliza endpoint self-hosted. | ✅ |
| **III — Multi-tenancy real** | El endpoint PATCH ya aplica `scoped(schema.contact.organizationId, session.organizationId, ...)`. Este spec no añade otro camino de DB. | ✅ |
| **IV — Idempotencia en integraciones externas** | PATCH name es idempotente (mismo body → mismo estado). El SSE que pueda llegar después no duplica: el `onConversationUpdated` solo dispara `refetchConversations`, que es de solo lectura. | ✅ |
| **V — Calidad verificable** | Helper pura testeable + E2E + manual Playwright + gate técnico. | ✅ |
| **VI — Specs antes de código** | Este PR es la documentación; la implementación viene en commits posteriores. | ✅ |
| **VII — Trazabilidad de decisiones** | Decisiones explícitas más abajo en §Decisiones. | ✅ |
| **VIII — Foco vertical** | Edición inline en el inbox, el producto. No broadcast, no scraping, no billing. | ✅ |
| **IX — Verificación en vivo** | Self-test E2E con guardarraíles + Playwright manual del camino feliz y del camino infeliz. | ✅ |

**Resultado**: sin violaciones. No hace falta Complexity Tracking.

## Project Structure

```
specs/005-quick-lead-name/
├── spec.md                     (este PR)
├── plan.md                     (este archivo)
└── tasks.md                    (este PR)

src/components/inbox/
├── contact-panel.tsx           (modificado en commit 1)
├── inbox-client.tsx            (modificado en commit 1: key + onContactUpdated)
├── conversation-list.tsx       (sin cambios)
├── conversation-patch.ts       (NUEVO commit 1 — helper pura)
└── helpers.ts                  (sin cambios; opcional clamplen si se quiere)

tests/unit/
└── conversation-patch.test.ts  (NUEVO commit 1 — tests de la helper)

tests/e2e/
└── 010-quick-lead-name.md      (NUEVO commit 1 — guion E2E / manual)
```

## Decisiones explícitas

> **D-1 — Sincronización post-guardado: patch in-place, no refetch.**
>
> Tres opciones consideradas:
>
> 1. `refetchConversations()` tras PATCH 200.
> 2. **Patch in-place del array `conversations` con `setConversations(prev => prev.map(...))`.**
> 3. Store global nuevo.
>
> Se elige **(2)** porque:
>
> - Es la latencia más baja (no hay round-trip extra).
> - Evita una race con SSE entrante que podría pisar la edición local en
>   curso (el refetch gana siempre; el patch in-place no).
> - No introduce estado nuevo (Cumple NFR-3 y la prohibición explícita del
>   prompt: "No introducir un store global nuevo para esta mejora").
> - Es trivialmente testeable como helper pura.
>
> El SSE posterior (`onConversationUpdated`, `onMessageNew`) sigue
> disparando `refetchConversations` (ya existente) y reconcilia
> asíncronamente con el servidor — sigue siendo la fuente de verdad.

> **D-2 — Re-mount al cambiar de conversación: `key={selected.contact.id}`.**
>
> El componente `ContactPanel` actualmente se mantiene montado entre
> selecciones de conversación (porque la prop `conversation` cambia pero el
> componente no se desmonta). Sin re-mount, el estado local de edición
> (modo, draft, error, saving) se preserva entre conversaciones, lo que
> es confuso y viola FR-12.
>
> Se añade `key={selected.contact.id}` en el JSX de `inbox-client.tsx`
> (líneas ~237-244) para forzar re-mount solo cuando cambia el id del
> contacto. Esto no introduce re-renders espurios por SSE (el id no cambia
> en updates SSE).

> **D-3 — Comportamiento de blur: cancela, no guarda.**
>
> Tres opciones:
>
> 1. **Blur cancela (descarta draft).**
> 2. Blur guarda.
> 3. Blur hace blur-save + botón "Cancelar" explícito.
>
> Se elige **(1)** por:
>
> - Conservador: previene pérdida accidental de un rename a medio escribir.
> - El operador que quiera velocidad tiene Enter (atajo principal).
> - Coherente con la Constitución VII (trazabilidad de decisiones bajo
>   incertidumbre): no se hace daño irreversible por accidente.
>
> Tradeoff explícito: el operador que prefiera UX tipo WhatsApp Web puede
> pedir blur-guarda en una iteración futura. Mientras tanto, la pérdida
> accidental es evitable; la doble confirmación no.

> **D-4 — Estado de edición y SSE concurrente.**
>
> Si llega un SSE `onMessageNew` o `onConversationUpdated` mientras el
> operador está editando (saving=false, mode="edit"), `refetchConversations`
> puede sobrescribir el draft. Defensa: el `ContactPanel` puede opcionalmente
> no aplicar el refetch de notas/etapas si está en modo edit (similar a lo
> que ya hace `refreshLive` para no pisar notas en curso — ver
> `contact-panel.tsx:88-104`). En este spec la edición es solo `name`, y el
> SSE no cambia `name` por sí mismo; el riesgo es solo que un rename
> concurrente del operador en otra pestaña/operador sobrescriba el draft.
> Mitigación: el draft NO se toca si `mode === "edit"`. Ver T101.

> **D-5 — Error UX.**
>
> - Validación cliente (vacío post-trim): error inline con texto
>   "El nombre no puede estar vacío".
> - API 4xx: muestra `data.error.message` o `data.message`, o fallback
>   "No se pudo guardar el nombre".
> - API 5xx: fallback "No se pudo guardar el nombre (intenta de nuevo)".
> - Network fail (`fetch` rejects): "Sin conexión con el servidor".
>
> Mensajes cortos, sin iconos de exclamación grandes; debajo del input,
> en `text-text-3` (gris), mismo tamaño que el placeholder.

> **D-6 — UX micro del icono lápiz.**
>
> - Icono `Pencil` de lucide (mismo set que ya usa el composer).
> - Tamaño 14 px, color `text-text-3` (gris discreto), hover `text-foreground`.
> - `aria-label="Editar nombre"`.
> - En modo edición se reemplaza por los botones de check/X (mismo tamaño
>   visual, mismo color por defecto).
> - Botón de check: `aria-label="Guardar nombre"`, deshabilitado si
>   `saving || draft.trim() === ""`.
> - Botón de X: `aria-label="Cancelar edición"`.

## Implementation Notes

### Helper pura (NUEVO — `src/components/inbox/conversation-patch.ts`)

```ts
import type { ConversationDto } from "@/lib/types";

/**
 * Devuelve un array nuevo donde la conversación cuyo contact.id coincide
 * tiene su `contact.name` reemplazado por `update.name`. Si no hay match,
 * devuelve el array original sin cambios. Inmutable.
 */
export function applyContactNamePatch(
  conversations: readonly ConversationDto[],
  update: { id: string; name: string }
): ConversationDto[];
```

Casos a cubrir (ver `tests/unit/conversation-patch.test.ts`):

- id existente → reemplaza `contact.name`, deja el resto intacto.
- id inexistente → array original sin cambios (misma referencia).
- múltiples conversaciones con mismo `id` (no debería pasar pero defensivo)
  → todas reemplazadas.
- inmutabilidad: el array y los objetos de conversación no se mutan.
- nombre idéntico al actual → array nuevo igual al anterior pero NO la
  misma referencia (mantener contrato "devuelve nuevo array").

### UI changes en `contact-panel.tsx`

```tsx
// Sustituir el bloque <p> nombre + teléfono (líneas ~163-170)
<section className="border-b p-4">
  <div className="flex items-center gap-3">
    <ContactAvatar ... />
    <div className="min-w-0 flex-1">
      <ContactNameEditor
        contactId={conversation.contact.id}
        name={conversation.contact.name}
        onSaved={({ id, name }) => {
          // salir de modo edición (lo gestiona ContactNameEditor)
          void onContactUpdated?.({ id, name });
        }}
      />
      <p className="text-xs text-text-3">
        {formatPhone(conversation.contact.phone)}
      </p>
    </div>
  </div>
  ...
</section>
```

`ContactNameEditor` es un componente local nuevo (mismo archivo) que
maneja `{ mode, draft, saving, error }` localmente.

### UI changes en `inbox-client.tsx`

- Añadir handler `onContactUpdated` en la sección del ContactPanel.
- Pasar `key={selected.contact.id}` al wrapper.

```tsx
const onContactUpdated = useCallback(({ id, name }: { id: string; name: string }) => {
  setConversations((prev) => applyContactNamePatch(prev ?? [], { id, name }));
}, []);

// ...
{selected && (
  <div className="h-full w-[320px]" key={selected.contact.id}>
    <ContactPanel
      conversation={selected}
      refreshKey={detailRev}
      onContactUpdated={onContactUpdated}
      onPatchConversation={patchConversation}
      onClose={() => togglePanel(false)}
    />
  </div>
)}
```

## Risks

- **R-1**: Una SSE entrante que llegue mientras `mode === "edit"` podría
  re-renderizar el input con el nombre del servidor, pisando el draft.
  Mitigación: la edición local NO se reemplaza desde refetch mientras
  `mode === "edit"` — solo el prop `name` que se pasa a `ContactNameEditor`
  cambia, pero el draft vive en `useState` interno y el componente no lo
  re-sincroniza con la prop (es controlled-by-user-only).
- **R-2**: Doble submit. Mitigación: `saving` ref + disabled visual + disabled
  del input. Tests cubrirán este caso.
- **R-3**: Cambiar de conversación a media edición. Mitigación:
  `key={selected.contact.id}` fuerza re-mount y descarta el estado local.

## Out of Scope reminder

- Edición de phone, email, empresa, tags.
- Creación de contactos.
- Modal / nueva página / store global.
- Cambios en pipeline, Sales, follow-ups, sender, webhook, schema.
- Endpoint paralelo.
- Auditoría de cambios de nombre.

## Verificación de cierre

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
2. `tests/unit/conversation-patch.test.ts` cubre ≥6 casos de la helper.
3. `tests/e2e/010-quick-lead-name.md` guionada (manual Playwright al menos).
4. Verificación manual del camino feliz y de los caminos infelices:
   - red caída durante el guardado;
   - servidor 400 (nombre > 120 chars);
   - blur mientras se edita (debe cancelar);
   - doble Enter durante `saving=true` (un solo PATCH);
   - cambiar de conversación mientras se edita (modo edición descartado);
   - SSE entrante durante la edición (draft preservado).
5. No-regresión del spec 004 (composer + cola).
6. Cierre: `tasks.md` marcado, `docs/CURRENT_STATE.md` actualizado.