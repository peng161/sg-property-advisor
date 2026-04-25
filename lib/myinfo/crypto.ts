// Server-only: Myinfo v4 cryptographic helpers
// Implements PKCE, DPoP, client assertion JWT, JWE decryption, JWS verification

import { randomBytes, createHash } from "crypto";
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  calculateJwkThumbprint,
  importPKCS8,
  compactDecrypt,
  createRemoteJWKSet,
  jwtVerify,
  type JWK,
} from "jose";

// ── PKCE ─────────────────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  // 32 random bytes → 43 base64url chars — within spec 43-128 range
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ── DPoP ─────────────────────────────────────────────────────────────────────

export async function generateDpopKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  return generateKeyPair("EC", { crv: "P-256" }) as Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }>;
}

// Serialise ephemeral key pair so it can be stored in a pending-auth cookie
export async function exportDpopKeyPair(
  pair: { privateKey: CryptoKey; publicKey: CryptoKey }
): Promise<{ privateJwk: JWK; publicJwk: JWK }> {
  const [privateJwk, publicJwk] = await Promise.all([
    exportJWK(pair.privateKey),
    exportJWK(pair.publicKey),
  ]);
  return { privateJwk, publicJwk };
}

export async function importDpopPrivateKey(jwk: JWK): Promise<CryptoKey> {
  const { default: subtle } = await import("node:crypto").then((m) => ({
    default: m.webcrypto.subtle,
  }));
  return subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"]
  ) as Promise<CryptoKey>;
}

export async function importDpopPublicKey(jwk: JWK): Promise<CryptoKey> {
  const { default: subtle } = await import("node:crypto").then((m) => ({
    default: m.webcrypto.subtle,
  }));
  return subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  ) as Promise<CryptoKey>;
}

export async function generateDpopProof(
  privateKey: CryptoKey,
  publicJwk: JWK,
  htm: string,
  htu: string,
  accessToken?: string
): Promise<string> {
  const payload: Record<string, unknown> = {
    jti: randomBytes(20).toString("hex"),
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
  };
  // ATH is required for resource server (Person API) calls but not for token endpoint
  if (accessToken) {
    payload.ath = createHash("sha256").update(accessToken).digest("base64url");
  }
  // spread publicJwk into the header; cast to bypass strict JWK type
  const dpopJwkHeader = { ...publicJwk, use: "sig", alg: "ES256" } as JWK;
  return new SignJWT(payload)
    .setProtectedHeader({
      alg: "ES256",
      jwk: dpopJwkHeader,
      typ: "dpop+jwt",
    })
    .sign(privateKey);
}

// ── Client assertion ──────────────────────────────────────────────────────────

export async function generateClientAssertion(
  clientId: string,
  tokenUrl: string,
  signingKeyPem: string,
  kid: string,
  dpopPublicJwk: JWK
): Promise<string> {
  const privateKey = await importPKCS8(signingKeyPem, "RS256");
  // JWK thumbprint of the DPoP public key bound to this assertion
  const jkt = await calculateJwkThumbprint(dpopPublicJwk, "sha256");

  return new SignJWT({ cnf: { jkt } })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(tokenUrl)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomBytes(16).toString("hex"))
    .sign(privateKey);
}

// ── JWS verification ──────────────────────────────────────────────────────────

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUrl: string) {
  if (!jwksCache.has(jwksUrl)) {
    jwksCache.set(jwksUrl, createRemoteJWKSet(new URL(jwksUrl)));
  }
  return jwksCache.get(jwksUrl)!;
}

export async function verifyJwsAndGetPayload(
  token: string,
  jwksUrl: string
): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, getJwks(jwksUrl), {
    // Allow a 5-minute clock skew between client and Myinfo servers
    clockTolerance: 300,
  });
  return payload as Record<string, unknown>;
}

// ── JWE decryption ────────────────────────────────────────────────────────────

// Myinfo person API response is JWE-encrypted with the app's public key.
// Try both common RSA-OAEP algorithms in case the key registration specifies either.
const JWE_ALGS = ["RSA-OAEP-256", "RSA-OAEP"] as const;

export async function decryptJwe(
  jwe: string,
  encryptionKeyPem: string
): Promise<string> {
  for (const alg of JWE_ALGS) {
    try {
      const key = await importPKCS8(encryptionKeyPem, alg);
      const { plaintext } = await compactDecrypt(jwe, key);
      return new TextDecoder().decode(plaintext);
    } catch {
      // Try next algorithm
    }
  }
  throw new Error("JWE decryption failed with all supported algorithms");
}
