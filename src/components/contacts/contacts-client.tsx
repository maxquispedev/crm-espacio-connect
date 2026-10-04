"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  MessageSquareText,
  Search,
  Users,
} from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";

export function ContactsClient() {
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [stages, setStages] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mismo rescate que en la Bandeja: lo tecleado antes de que hidrate el JS
  // se perdía en silencio. Ver conversation-list.tsx.
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pipeline/stages").catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { stages: { name: string }[] };
      setStages(data.stages.map((s) => s.name));
    })();
  }, []);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (stage !== "all") params.set("stage", stage);
    if (showArchived) params.set("archived", "true");
    const res = await fetch(`/api/contacts?${params}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { contacts: ContactDto[] };
    setContacts(data.contacts);
  }, [query, stage, showArchived]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Contactos"
        icon={Users}
        count={contacts.length}
        hint="Contactos del negocio, con su etapa y sus notas."
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-text-3">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="accent-primary"
              />
              Ver archivados
            </label>
            {stages.length > 0 && (
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                aria-label="Filtrar por etapa del embudo"
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="all">Toda etapa</option>
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 px-6 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-text-3" />
            <Input
              ref={inputRef}
              placeholder="Buscar por nombre o teléfono…"
              aria-label="Buscar contacto"
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-72 pl-8"
            />
          </div>
        </div>
        <div className="px-6 pb-6">
          {contacts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              {query.trim() || stage !== "all" ? (
                <>
                  <p className="text-sm font-medium">Sin resultados</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Nadie coincide con
                    {query.trim() ? ` «${query.trim()}»` : ""}
                    {query.trim() && stage !== "all" ? " en" : ""}
                    {stage !== "all" ? ` la etapa «${stage}»` : ""}.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Sin contactos</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Cada persona que escriba a tu WhatsApp quedará registrada
                    aquí automáticamente.
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
                >
                  <ContactAvatar name={c.name} seed={c.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.name}
                      </span>
                      {c.stageName && (
                        <Badge variant="outline">{c.stageName}</Badge>
                      )}
                      {c.archivedAt && (
                        <Badge variant="secondary">Archivado</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatPhone(c.phone)}
                      {c.notes ? ` · ${c.notes.slice(0, 60)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(c)}
                    >
                      Editar
                    </Button>
                    <Link href={`/inbox?contact=${c.id}`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Abrir conversación"
                      >
                        <MessageSquareText className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={c.archivedAt ? "Desarchivar" : "Archivar"}
                      onClick={() =>
                        void patch(c.id, { archived: !c.archivedAt })
                      }
                    >
                      {c.archivedAt ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <EditDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={async (patchBody) => {
            await patch(editing.id, patchBody);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditDialog({
  contact,
  onClose,
  onSave,
}: {
  contact: ContactDto;
  onClose: () => void;
  onSave: (patch: { name: string; notes: string }) => Promise<void>;
}) {
  const [name, setName] = useState(contact.name);
  const [notes, setNotes] = useState(contact.notes ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Editar contacto</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-name">
              Nombre
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-notes">
              Notas
            </label>
            <Textarea
              id="edit-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => void onSave({ name: name.trim(), notes })}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
