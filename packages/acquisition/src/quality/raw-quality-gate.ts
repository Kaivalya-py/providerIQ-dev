import type { RawEvidence } from '../types/raw-evidence.types.js';

export interface QualityGateResult {
  accepted: RawEvidence[];
  rejected: (RawEvidence & { reason?: string })[];
}

export function runRawQualityGate(records: RawEvidence[]): QualityGateResult {
  const accepted: RawEvidence[] = [];
  const rejected: (RawEvidence & { reason?: string })[] = [];

  for (const record of records) {
    const text = record.text ?? '';

    // Reject empty reviews
    if (text.trim().length < 10) {
      rejected.push({ ...record, reason: 'too_short' });
      continue;
    }

    // Reject likely spam (all caps, repeated characters)
    if (text.length > 20 && text === text.toUpperCase()) {
      rejected.push({ ...record, reason: 'all_caps_spam' });
      continue;
    }

    // Reject if suspicious repetition pattern
    const words = text.split(/\s+/);
    if (words.length > 5) {
      const uniqueWords = new Set(words.map(w => w.toLowerCase()));
      if (uniqueWords.size / words.length < 0.3) {
        rejected.push({ ...record, reason: 'repetitive_spam' });
        continue;
      }
    }

    accepted.push(record);
  }

  return { accepted, rejected };
}
