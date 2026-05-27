import type { RawEvidence } from './raw-evidence.types.js';

export interface ConnectorInput {
  runId: string;
  seed: {
    id: string;
    name: string;
    city?: string;
    state?: string;
    website?: string;
  };
  options?: Record<string, unknown>;
}

export interface RawEvidenceBatch {
  source: string;
  sourceType: string;
  records: RawEvidence[];
  warnings: string[];
  partial: boolean;
}
