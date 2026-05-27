import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AcquisitionConfig } from '../config/acquisition-config.js';
import { canonicalizeSourceUrl } from '../normalization/source-url-normalizer.js';
import { csvRowsToObjects, parseCsvRows } from '../normalization/csv.js';
import { sha256Hash } from '../normalization/text-normalizer.js';
import type { ConnectorInput, RawEvidenceBatch } from '../types/connector.types.js';
import type { RawEvidence } from '../types/raw-evidence.types.js';
import { BasePublicEvidenceConnector } from './base.connector.js';

export class GoogleReviewsApifyConnector extends BasePublicEvidenceConnector {
  source = 'GOOGLE_MAPS_REVIEWS' as const;
  name = 'GoogleReviewsApifyConnector';
  version = '0.1.0';

  constructor(private readonly config: AcquisitionConfig, private readonly cwd = process.cwd()) {
    super();
  }

  async fetch(input: ConnectorInput): Promise<RawEvidenceBatch> {
    const csvPath = resolve(this.cwd, this.config.apifyAmbicCsvPath);
    const content = await readFile(csvPath, 'utf8');
    const rows = csvRowsToObjects(parseCsvRows(content));

    const candidates = rows.filter((row) => this.matchesSeed(row, input));
    const maxReviews = input.options?.maxRecords ?? this.config.maxGoogleReviews;

    const reviewRows = candidates
      .filter((row) => (row['review_rating'] ?? '').trim() !== '' || (row['review_text'] ?? '').trim() !== '')
      .slice(0, maxReviews);

    const records = reviewRows.map((row) => this.toRawEvidence(row, input));
    const identityCandidates = this.createIdentityCandidates(candidates, input.runId);

    return {
      source: this.source,
      sourceType: 'review',
      records,
      identityCandidates,
      warnings: records.length === 0 ? ['no_apify_reviews_matched_seed'] : [],
      partial: false,
    };
  }

  private matchesSeed(row: Record<string, string>, input: ConnectorInput): boolean {
    const name = normalize(row['google_name'] || row['asc_name']);
    const city = normalize(row['asc_city']);
    const seedName = normalize(input.seed.name);
    const seedCity = normalize(input.seed.city);

    const placeIdFromIdentity = input.identityCandidates?.[0]?.sourceId;
    if (placeIdFromIdentity && row['place_id'] && placeIdFromIdentity === row['place_id']) {
      return true;
    }

    const nameMatch = seedName.length > 0 && (name.includes(seedName) || seedName.includes(name));
    const cityMatch = !seedCity || city.includes(seedCity) || seedCity.includes(city);
    return nameMatch && cityMatch;
  }

  private toRawEvidence(row: Record<string, string>, input: ConnectorInput): RawEvidence {
    const reviewUrl = row['review_url'] || row['google_maps_url'] || '';
    const sourceRecordId = extractReviewId(reviewUrl) || sha256Hash(`${row['review_author']}|${row['review_date']}|${row['review_text']}`);
    const placeId = row['place_id'];
    const author = row['review_author'];

    return {
      id: randomUUID(),
      hospitalSeedId: input.seed.id,
      source: this.source,
      sourceType: 'review',
      sourceUrl: reviewUrl || row['google_maps_url'] || `https://www.google.com/maps/search/?query=${encodeURIComponent(input.seed.name)}`,
      canonicalSourceUrl: canonicalizeSourceUrl(reviewUrl || row['google_maps_url'] || ''),
      sourceRecordId,
      collectedAt: new Date().toISOString(),
      publishedAt: normalizeDate(row['review_date']),
      title: row['google_name'] || input.seed.name,
      text: row['review_text'] || undefined,
      rating: parseNum(row['review_rating']),
      ratingScale: 5,
      reviewCount: parseNum(row['total_reviews']),
      authorDisplayNameHash: author ? sha256Hash(author.toLowerCase()) : undefined,
      publicAuthorMetadata: {
        profilePhotoPresent: false,
      },
      platformMetadata: {
        ownerResponseText: row['owner_response'] || undefined,
        ownerResponsePublishedAt: undefined,
        imagesPresent: false,
        language: 'en',
        sortMode: 'newest',
      },
      hospitalMatch: {
        confidence: 0.8,
        matchedName: row['google_name'] || row['asc_name'] || input.seed.name,
        matchedAddress: row['google_address'] || input.seed.address,
        matchedWebsite: row['google_maps_url'] || input.seed.website,
        matchReasons: ['ambic_apify_csv_match', ...(placeId ? ['place_id_present'] : [])],
      },
      acquisition: {
        connectorName: this.name,
        connectorVersion: this.version,
        runId: input.runId,
        method: 'managed_scraper',
        rawPayloadLocation: `${this.config.apifyAmbicCsvPath}#place_id=${placeId ?? 'unknown'}`,
        extractionConfidence: 0.85,
      },
      rawQualityFlags: [],
      piiFlags: {},
      processingStatus: 'raw_collected',
    };
  }

  private createIdentityCandidates(rows: Array<Record<string, string>>, runId: string) {
    const deduped = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const key = row['place_id'] || `${row['google_name']}-${row['google_address']}`;
      if (!deduped.has(key)) deduped.set(key, row);
    }

    return [...deduped.values()].slice(0, 10).map((row) => ({
      id: randomUUID(),
      canonicalName: row['google_name'] || row['asc_name'] || '',
      matchedName: row['google_name'] || row['asc_name'] || '',
      source: 'google_maps' as const,
      sourceId: row['place_id'] || undefined,
      sourceUrl: row['google_maps_url'] || undefined,
      address: row['google_address'] || undefined,
      website: row['google_maps_url'] || undefined,
      confidence: 0.7,
      matchReasons: ['apify_review_dataset_candidate', `run:${runId}`],
    }));
  }
}

function parseNum(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function extractReviewId(reviewUrl: string): string | undefined {
  if (!reviewUrl) return undefined;
  const match = reviewUrl.match(/\|([^|?]+)\|\?/);
  return match?.[1];
}

function normalize(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
