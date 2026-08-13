import { cookies } from "next/headers";
import { AppearanceClient } from "@/components/settings/appearance-client";
import { parseThemePreference, THEME_COOKIE } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const cookieStore = await cookies();
  const initialTheme = parseThemePreference(cookieStore.get(THEME_COOKIE)?.value);
  return <AppearanceClient initialTheme={initialTheme} />;
}
