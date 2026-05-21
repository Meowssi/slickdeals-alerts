// Server-only TOTP (RFC 6238) implementation + QR code helper.
// 30-second period, 6 digits, SHA-1 (Google Authenticator / Authy / 1Password
// defaults). Pure Node crypto — no external auth deps.

import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import QRCode from "qrcode";

const PERIOD = 30;       // seconds
const DIGITS = 6;
const WINDOW = 1;        // accept current ±1 step (60s tolerance for clock skew)

// ---- base32 (RFC 4648, no padding) ------------------------------------------
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function decodeBase32(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---- TOTP core --------------------------------------------------------------

export function generateSecret(): string {
  return encodeBase32(randomBytes(20));
}

function counterAt(unixSeconds: number): Buffer {
  const t = Math.floor(unixSeconds / PERIOD);
  const buf = Buffer.alloc(8);
  // big-endian 64-bit. Math.floor(t / 2^32) gives high word safely.
  buf.writeUInt32BE(Math.floor(t / 0x1_0000_0000), 0);
  buf.writeUInt32BE(t >>> 0, 4);
  return buf;
}

function hotp(secret: Buffer, counter: Buffer): string {
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (code % Math.pow(10, DIGITS)).toString().padStart(DIGITS, "0");
}

export function currentCode(secretBase32: string, nowSeconds?: number): string {
  const t = nowSeconds ?? Math.floor(Date.now() / 1000);
  return hotp(decodeBase32(secretBase32), counterAt(t));
}

export function verifyCode(secretBase32: string, code: string, nowSeconds?: number): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const secret = decodeBase32(secretBase32);
  const t = nowSeconds ?? Math.floor(Date.now() / 1000);
  for (let w = -WINDOW; w <= WINDOW; w++) {
    if (hotp(secret, counterAt(t + w * PERIOD)) === trimmed) return true;
  }
  return false;
}

// ---- otpauth URI + QR ------------------------------------------------------

export function otpAuthUri(opts: {
  secret: string;
  label: string;   // e.g. "alerts@example.com"
  issuer: string;  // e.g. "Slickdeals Alerts"
}): string {
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  const label = encodeURIComponent(`${opts.issuer}:${opts.label}`);
  return `otpauth://totp/${label}?${params.toString()}`;
}

export async function qrPngDataUrl(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl, {
    margin: 2,
    width: 256,
    errorCorrectionLevel: "M",
  });
}
