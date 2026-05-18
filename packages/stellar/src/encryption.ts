/**
 * AES-256-GCM encryption para secret keys de vendor (Modo AEGIS).
 *
 * - Algoritmo: AES-256-GCM (authenticated encryption — detecta tampering)
 * - Chave: 32 bytes (256 bits) de env var `VENDOR_KEY_ENCRYPTION_KEY` em hex
 * - IV: 12 bytes random por mensagem
 * - Format de saída: `iv:authTag:ciphertext` em hex, separados por `:`
 *
 * Roadmap Marco 2: migrar para KMS por vendor (uma KMS key por vendor key).
 * Pra MVP testnet, AES-256-GCM com chave master é suficiente.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SEPARATOR = ':';

function getKey(rawKey: string): Buffer {
  const buf = Buffer.from(rawKey, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `VENDOR_KEY_ENCRYPTION_KEY deve ter ${KEY_BYTES * 2} chars hex (${KEY_BYTES} bytes); recebido ${buf.length} bytes.`,
    );
  }
  return buf;
}

export function encryptSecret(plaintext: string, encryptionKeyHex: string): string {
  const key = getKey(encryptionKeyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), enc.toString('hex')].join(SEPARATOR);
}

export function decryptSecret(ciphertext: string, encryptionKeyHex: string): string {
  const parts = ciphertext.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new Error(`Formato inválido: esperado "iv:authTag:ciphertext"`);
  }
  const [ivHex, authTagHex, encHex] = parts as [string, string, string];
  const key = getKey(encryptionKeyHex);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Gera uma nova VENDOR_KEY_ENCRYPTION_KEY pronta para colar em env.
 * Uso: console no setup-treasury, ou one-off via `node -e ...`.
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}
