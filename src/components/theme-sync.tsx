"use client";

import { useLayoutEffect } from "react";
import { applyThemePreference, readThemePreference } from "@/lib/theme";

/**
 * Reaplica el tema tras la hidratación (por si React reescribe `class` en
 * `<html>`) y mantiene `system` alineado con el SO mientras la pestaña vive.
 * El primer paint lo resuelve el script blocking del layout (anti-FOUC).
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyThemePreference(readThemePreference());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemePreference() === "system") applyThemePreference("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}
