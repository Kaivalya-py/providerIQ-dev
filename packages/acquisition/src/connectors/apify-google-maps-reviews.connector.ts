import { randomUUID } from 'node:crypto';
import type { AcquisitionConfig } from '../config/acquisition-config.js';
import { canonicalizeSourceUrl } from '../normalization/source-url-normalizer.js';
import { sha256Hash } from '../normalization/text-normalizer.js';
import type { ConnectorInput, RawEvidenceBatch } from '../types/connector.types.js';
import type { RawEvidence } from '../types/raw-evidence.types.js';
import { BasePublicEvidenceConnector } from './base.connector.js';

interface RunActorResponse {
  data?: {
    id?: string;
    status?: string;
    defaultDatasetId?: string;
  };
}

export interface ApifyGoogleMapsReviewsFetchInput {
  runId: string;
  hospitalSeedId: string;
  hospitalName: string;
  city?: string;
  googleMapsUrl?: string;
  maxReviews: number;
  reviewsSort?: 'newest' | 'mostRelevant' | 'highestRanking' | 'lowestRanking';
  apiTokenOverride?: string;
}

export interface ApifyFetchResult {
  actorRunId: string;
  datasetId: string;
  actorInput: Record<string, unknown>;
  apifyRawItems: Record<string, unknown>[];
  records: RawEvidence[];
}

export class ApifyGoogleMapsReviewsConnector extends BasePublicEvidenceConnector {
  source = 'GOOGLE_MAPS_REVIEWS' as const;
  name = 'ApifyGoogleMapsReviewsConnector';
  version = '1.0.0';

  constructor(private readonly config: AcquisitionConfig) {
    super();
  }

  async fetch(input: ConnectorInput): Promise<RawEvidenceBatch> {
    const googleMapsUrl = input.options?.googleMapsUrl ?? input.seed.website;
    if (!googleMapsUrl) {
      throw new Error('ApifyGoogleMapsReviewsConnector requires googleMapsUrl. Provide --googleMapsUrl or seed.website.');
    }

    const maxReviews = input.options?.maxRecords ?? this.config.maxGoogleReviews;
    const result = await this.fetchReviews({
      runId: input.runId,
      hospitalSeedId: input.seed.id,
      hospitalName: input.seed.name,
      city: input.seed.city,
      googleMapsUrl,
      maxReviews,
    });

    return {
      source: this.source,
      sourceType: 'review',
      records: result.records,
      warnings: [],
      partial: false,
    };
  }

  async fetchReviews(input: ApifyGoogleMapsReviewsFetchInput): Promise<ApifyFetchResult> {
    const apiToken = input.apiTokenOverride ?? this.config.apifyApiToken;
    if (!apiToken) {
      throw new Error('Missing APIFY_API_TOKEN. Set APIFY_API_TOKEN in environment before running MVP acquisition.');
    }

    const actorId = this.config.apifyGoogleReviewsActorId;
    if (!actorId) {
      throw new Error('Missing APIFY_GOOGLE_REVIEWS_ACTOR_ID. Configure the actor ID for Google Maps review scraping.');
    }

    // Support both URL-based and name-based search
    const actorInput: Record<string, unknown> = {
      maxReviews: input.maxReviews,
      reviewsSort: input.reviewsSort ?? 'newest',
      language: 'en',
    };

    if (input.googleMapsUrl) {
      actorInput.startUrls = [{ url: input.googleMapsUrl }];
    } else {
      // Use searchStringsArray for name-based discovery
      const searchQuery = input.city
        ? `${input.hospitalName} ${input.city}`
        : input.hospitalName;
      actorInput.searchStringsArray = [searchQuery];
    }

    const actorApiPathId = normalizeActorApiPathId(actorId);
    const runUrl = new URL(`https://api.apify.com/v2/acts/${actorApiPathId}/runs`);
    runUrl.searchParams.set('token', apiToken);

    console.log(`    [Apify] Starting actor run...`);
    const runResponse = await this.withRetry(() =>
      fetch(runUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(actorInput),
      })
    );

    if (!runResponse.ok) {
      const body = await runResponse.text();
      throw new Error(`Apify actor run failed (${runResponse.status}): ${body.slice(0, 400)}`);
    }

    const runJson = (await runResponse.json()) as RunActorResponse;
    const actorRunId = runJson.data?.id;
    const datasetId = runJson.data?.defaultDatasetId;

    if (!actorRunId || !datasetId) {
      throw new Error('Apify actor response missing run id or default dataset id.');
    }

    // Poll for completion (up to 30 minutes)
    const maxPollTime = 30 * 60 * 1000;
    const pollInterval = 10_000;
    const startTime = Date.now();
    let finalStatus = runJson.data?.status;

    while (finalStatus !== 'SUCCEEDED' && finalStatus !== 'FAILED' && finalStatus !== 'ABORTED' && finalStatus !== 'TIMED-OUT') {
      if (Date.now() - startTime > maxPollTime) {
        throw new Error(`Apify actor run timed out after 30 minutes. Run ID: ${actorRunId}, last status: ${finalStatus}`);
      }
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`    [Apify] Waiting for actor... (${elapsed}s elapsed, status: ${finalStatus})`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusUrl = new URL(`https://api.apify.com/v2/actor-runs/${actorRunId}`);
      statusUrl.searchParams.set('token', apiToken);
      const statusResp = await fetch(statusUrl);
      if (statusResp.ok) {
        const statusJson = (await statusResp.json()) as RunActorResponse;
        finalStatus = statusJson.data?.status;
      }
    }

    if (finalStatus !== 'SUCCEEDED') {
      throw new Error(`Apify actor did not succeed. Run status: ${finalStatus}. Run ID: ${actorRunId}`);
    }
    console.log(`    [Apify] Actor run succeeded in ${Math.round((Date.now() - startTime) / 1000)}s`);

    const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${datasetId}/items`);
    datasetUrl.searchParams.set('token', apiToken);
    datasetUrl.searchParams.set('clean', 'true');
    datasetUrl.searchParams.set('format', 'json');

    const datasetResponse = await this.withRetry(() => fetch(datasetUrl));
    if (!datasetResponse.ok) {
      const body = await datasetResponse.text();
      throw new Error(`Failed to fetch Apify dataset items (${datasetResponse.status}): ${body.slice(0, 400)}`);
    }

    const items = (await datasetResponse.json()) as unknown;
    if (!Array.isArray(items)) {
      throw new Error('Apify dataset response is not an array.');
    }

    const apifyRawItems = items as Record<string, unknown>[];
    if (apifyRawItems.length === 0) {
      throw new Error(`Apify returned no reviews for ${input.hospitalName} (${input.googleMapsUrl}).`);
    }

    const records = apifyRawItems.map((item, index) =>
      this.toRawEvidence(item, {
        ...input,
        datasetId,
        itemIndex: index,
      })
    );

    if (records.length === 0) {
      throw new Error(`Apify returned ${apifyRawItems.length} items but none could be normalized into RawEvidence.`);
    }

    return {
      actorRunId,
      datasetId,
      actorInput,
      apifyRawItems,
      records,
    };
  }

  private toRawEvidence(
    item: Record<string, unknown>,
    input: ApifyGoogleMapsReviewsFetchInput & { datasetId: string; itemIndex: number }
  ): RawEvidence {
    const sourceUrl =
      pickString(item, ['reviewUrl', 'review_url', 'url']) ??
      pickString(item, ['placeUrl', 'googleMapsUrl', 'google_maps_url']) ??
      input.googleMapsUrl;

    const reviewText = pickString(item, ['text', 'reviewText', 'review_text', 'snippet']) ?? undefined;
    const reviewDateRaw = pickString(item, ['publishedAtDate', 'publishedAt', 'published_at', 'date', 'reviewDate']);
    const reviewDateIso = normalizeDate(reviewDateRaw);
    const rating = pickNumber(item, ['stars', 'rating', 'reviewStars', 'review_rating']);
    const authorName = pickString(item, ['name', 'authorName', 'reviewerName', 'review_author']);
    const reviewId = pickString(item, ['reviewId', 'review_id', 'id']);

    const sourceRecordId =
      reviewId ||
      sha256Hash([
        authorName ?? '',
        reviewDateIso ?? reviewDateRaw ?? '',
        reviewText ?? '',
        sourceUrl,
      ].join('|'));

    const publishedAt = reviewDateIso ?? new Date().toISOString();

    return {
      id: randomUUID(),
      hospitalSeedId: input.hospitalSeedId,
      source: this.source,
      sourceType: 'review',
      sourceUrl,
      canonicalSourceUrl: canonicalizeSourceUrl(sourceUrl),
      sourceRecordId,
      collectedAt: new Date().toISOString(),
      publishedAt,
      title: input.hospitalName,
      text: reviewText,
      rating,
      ratingScale: rating !== undefined ? 5 : undefined,
      authorDisplayNameHash: authorName ? sha256Hash(authorName.toLowerCase()) : undefined,
      publicAuthorMetadata: {
        reviewCount: pickNumber(item, ['reviewsCount', 'reviewerNumberOfReviews']),
        localGuide: pickBoolean(item, ['isLocalGuide', 'localGuide']),
        profilePhotoPresent: pickBoolean(item, ['profilePhotoPresent', 'hasProfilePicture']) ?? false,
      },
      platformMetadata: {
        helpfulVotes: pickNumber(item, ['likesCount', 'helpfulVotes']),
        ownerResponseText: pickString(item, ['responseFromOwnerText', 'ownerResponse', 'owner_response']) ?? undefined,
        ownerResponsePublishedAt:
          normalizeDate(pickString(item, ['responseFromOwnerDate', 'ownerResponseDate'])) ?? undefined,
        imagesPresent: pickBoolean(item, ['photos', 'imagesPresent']) ?? false,
        language: pickString(item, ['language', 'reviewLanguage']) ?? 'en',
        sortMode: 'newest',
      },
      hospitalMatch: {
        confidence: 0.9,
        matchedName: input.hospitalName,
        matchedWebsite: input.googleMapsUrl,
        matchReasons: ['apify_actor_google_maps_url_seeded'],
      },
      acquisition: {
        connectorName: this.name,
        connectorVersion: this.version,
        runId: input.runId,
        method: 'managed_scraper',
        rawPayloadLocation: `apify:dataset:${input.datasetId}:item:${input.itemIndex}`,
        extractionConfidence: 0.9,
      },
      rawQualityFlags: [],
      piiFlags: {},
      processingStatus: 'raw_collected',
    };
  }
}

function pickString(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumber(item: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickBoolean(item: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
  }
  return undefined;
}

function normalizeDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeActorApiPathId(actorId: string): string {
  // Apify API paths use owner~actor-name; convert owner/actor-name config values.
  if (actorId.includes('/')) {
    const [owner, ...rest] = actorId.split('/');
    if (owner && rest.length > 0) {
      return `${owner}~${rest.join('/')}`;
    }
  }
  return actorId;
}
