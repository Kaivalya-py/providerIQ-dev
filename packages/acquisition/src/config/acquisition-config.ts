import { DEFAULT_CONNECTOR_TIMEOUT_MS } from '../constants/acquisition.constants.js';

export interface AcquisitionConfig {
  googlePlacesApiKey?: string;
  apifyApiToken?: string;
  apifyGoogleReviewsActorId?: string;
  apifyPractoActorId?: string;
  practoMaxItemsDefault: number;
  serpApiKey?: string;
  firecrawlApiKey?: string;
  tavilyApiKey?: string;
  exaApiKey?: string;

  defaultMaxReviewsPerSource: number;
  maxGoogleReviews: number;
  maxPractoRecords: number;
  maxJustDialRecords: number;
  maxComplaintUrls: number;

  connectorTimeoutMs: number;
  enableBrowserFallback: boolean;
  enableFullPublicScan: boolean;

  // Local seed data path for Apify-style review ingestion fixtures.
  apifyAmbicCsvPath: string;
}

export function buildAcquisitionConfig(env: NodeJS.ProcessEnv = process.env): AcquisitionConfig {
  return {
    googlePlacesApiKey: env['GOOGLE_PLACES_API_KEY'],
    apifyApiToken: env['APIFY_API_TOKEN'],
    apifyGoogleReviewsActorId: env['APIFY_GOOGLE_REVIEWS_ACTOR_ID'],
    apifyPractoActorId: env['APIFY_PRACTO_ACTOR_ID'] ?? 'jungle_synthesizer/practo-doctor-scraper',
    practoMaxItemsDefault: Number(env['PRACTO_MAX_ITEMS_DEFAULT'] ?? 50),
    serpApiKey: env['SERPAPI_API_KEY'],
    firecrawlApiKey: env['FIRECRAWL_API_KEY'],
    tavilyApiKey: env['TAVILY_API_KEY'],
    exaApiKey: env['EXA_API_KEY'],
    defaultMaxReviewsPerSource: Number(env['ACQ_DEFAULT_MAX_REVIEWS'] ?? 250),
    maxGoogleReviews: Number(env['ACQ_MAX_GOOGLE_REVIEWS'] ?? 1000),
    maxPractoRecords: Number(env['ACQ_MAX_PRACTO_RECORDS'] ?? 250),
    maxJustDialRecords: Number(env['ACQ_MAX_JUSTDIAL_RECORDS'] ?? 250),
    maxComplaintUrls: Number(env['ACQ_MAX_COMPLAINT_URLS'] ?? 100),
    connectorTimeoutMs: Number(env['ACQ_CONNECTOR_TIMEOUT_MS'] ?? DEFAULT_CONNECTOR_TIMEOUT_MS),
    enableBrowserFallback: env['ACQ_ENABLE_BROWSER_FALLBACK'] === 'true',
    enableFullPublicScan: env['ACQ_ENABLE_FULL_PUBLIC_SCAN'] === 'true',
    apifyAmbicCsvPath: env['ACQ_APIFY_AMBIC_CSV_PATH'] ?? 'Ambic/asc_reviews_apify.csv',
  };
}
