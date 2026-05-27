import type { RawEvidence } from '../types/raw-evidence.types.js';
import { sha256Hash } from '../normalization/text-normalizer.js';

export interface DedupeResult {
  unique: RawEvidence[];
  duplicates: RawEvidence[];
}

export function dedupeRawEvidence(records: RawEvidence[]): DedupeResult {
  const seen = new Set<string>();
  const unique: RawEvidence[] = [];
  const duplicates: RawEvidence[] = [];

  for (const record of records) {
    const contentKey = sha256Hash(
      [record.text ?? '', record.authorDisplayNameHash ?? '', record.publishedAt ?? ''].join('|')
    );

    if (seen.has(contentKey)) {
      duplicates.push(record);
    } else {
      seen.add(contentKey);
      unique.push(record);
    }
  }

  return { unique, duplicates };
}
