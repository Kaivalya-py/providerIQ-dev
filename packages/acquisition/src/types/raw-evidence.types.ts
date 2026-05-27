export interface RawEvidence {
  id: string;
  hospitalSeedId: string;
  source: string;
  sourceType: string;
  sourceUrl?: string;
  canonicalSourceUrl?: string;
  sourceRecordId: string;
  collectedAt: string;
  publishedAt: string;
  title?: string;
  text?: string;
  rating?: number;
  ratingScale?: number;
  authorDisplayNameHash?: string;
  publicAuthorMetadata?: Record<string, unknown>;
  platformMetadata?: Record<string, unknown>;
  hospitalMatch?: Record<string, unknown>;
  acquisition?: Record<string, unknown>;
  rawQualityFlags: string[];
  piiFlags: Record<string, unknown>;
  processingStatus: string;
}
