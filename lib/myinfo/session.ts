// Server-only: encrypt/decrypt the financial profile stored in an httpOnly cookie
// Uses AES-256-GCM via jose EncryptJWT (symmetric, dir + A256GCM)

import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash, createSecretKey } from "crypto";
import type { FinancialProfile } from "./types";

export const SESSION_COOKIE = "myinfo_session";
export const PENDING_COOKIE  = "myinfo_pending";

// Derive a 32-byte key from the secret string (any length accepted)
function sessionKey() {
  const raw = process.env.MYINFO_SESSION_SECRET ?? "";
  const bytes = createHash("sha256").update(raw).digest();
  return createSecretKey(bytes);
}

export async function encryptProfile(profile: FinancialProfile): Promise<string> {
  return new EncryptJWT(profile as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime("1h")
    .encrypt(sessionKey());
}

export async function decryptProfile(token: string): Promise<FinancialProfile | null> {
  try {
    const { payload } = await jwtDecrypt(token, sessionKey());
    return payload as unknown as FinancialProfile;
  } catch {
    return null;
  }
}
