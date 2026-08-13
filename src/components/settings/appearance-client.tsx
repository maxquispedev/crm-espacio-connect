"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import {
  applyThemePreference,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
  icon: typeof Sun;
}[] = [
  {
    value: "light",
    label: "Claro",
    hint: "Fondos claros, siempre.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Oscuro",
    hint: "Fondos oscuros, siempre.",
    icon: Moon,
  },
  {
    value: "system",
    label: "Sistema",
    hint: "Sigue el tema del sistema operativo.",
    icon: Monitor,
  },
];

export function AppearanceClient({
  initialTheme,
}: {
  initialTheme: ThemePreference;
}) {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);

  function select(next: ThemePreference) {
    setTheme(next);
    applyThemePreference(next);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Apariencia</CardTitle>
          <CardDescription>
            Elige cómo se ve el CRM en este dispositivo. No afecta a tu equipo
            ni cambia al cambiar de organización.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">Tema</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {OPTIONS.map((opt) => {
                const selected = theme === opt.value;
                const Icon = opt.icon;
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors",
                      selected
                        ? "border-brand bg-brand-tint"
                        : "hover:bg-accent"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="theme"
                        value={opt.value}
                        checked={selected}
                        onChange={() => select(opt.value)}
                        className="accent-brand"
                      />
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          selected ? "text-brand" : "text-text-3"
                        )}
                        strokeWidth={1.7}
                      />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          selected ? "text-brand-text" : "text-foreground"
                        )}
                      >
                        {opt.label}
                      </span>
                    </span>
                    <span className="pl-6 text-xs text-text-3">{opt.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
