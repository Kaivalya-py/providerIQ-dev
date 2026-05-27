import { createHash } from 'node:crypto';

export function sha256Hash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
