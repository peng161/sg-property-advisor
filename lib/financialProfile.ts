// Server-side: read the financial profile from the session cookie.
// Returns null when no session is present — caller shows manual entry or Singpass CTA.

import { cookies } from "next/headers";
import { decryptProfile, SESSION_COOKIE } from "./myinfo/session";
import type { FinancialProfile } from "./myinfo/types";

export type { FinancialProfile };

export async function getUserFinancialProfile(): Promise<FinancialProfile | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decryptProfile(token);
}
