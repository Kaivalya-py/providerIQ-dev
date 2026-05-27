import crypto from 'node:crypto';
import { ApifyClient } from 'apify-client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PractoReviewEvidence {
  id: string;
  hospitalSeedId: string;

  source: 'PRACTO';
  sourceType: 'review';

  sourceUrl: string;
  collectedAt: string;
  publishedAt?: string;

  title?: string;
  text: string;
  authorName?: string;

  rating?: number;
  ratingScale: 5;

  platformMetadata?: Record<string, unknown>;

  acquisition: {
    connectorName: string;
    connectorVersion: string;
    runId: string;
    method: 'managed_scraper';
    externalRunId?: string;
    externalDatasetId?: string;
  };

  processingStatus: 'ready_for_classification' | 'raw_collected';
}

export interface PractoReviewConnectorInput {
  runId: string;
  hospitalSeedId: string;

  hospitalName: string;
  city: string;

  /** Override the auto-generated slug if you know the exact Practo slug */
  hospitalSlug?: string;

  /** Max pages to scroll/load (each scroll loads ~10 reviews) */
  maxScrolls?: number;
}

export interface PractoReviewConnectorConfig {
  apifyApiToken: string;
  /** Memory in MB for the web scraper actor (default: 1024) */
  memoryMbytes?: number;
}

export interface PractoReviewConnectorResult {
  runId: string;
  actorRunId?: string;
  datasetId?: string;
  totalReviews: number;
  reviewPageUrl: string;
  evidence: PractoReviewEvidence[];
  warnings: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableId(parts: Array<string | undefined>): string {
  return sha256(parts.filter(Boolean).join('|')).slice(0, 32);
}

// ─── Page Function (runs in browser context inside apify/web-scraper) ────────

const PRACTO_REVIEW_PAGE_FUNCTION = `
async function pageFunction(context) {
  const results = [];
  const { request } = context;

  // Wait for review content to load
  await new Promise(r => setTimeout(r, 5000));

  // Scroll to load more reviews (Practo lazy-loads them)
  const maxScrolls = request.userData?.maxScrolls ?? 8;
  for (let i = 0; i < maxScrolls; i++) {
    window.scrollBy(0, window.innerHeight);
    await new Promise(r => setTimeout(r, 1500));
  }

  // Try clicking "Read more" / "Show more reviews" buttons
  const moreButtons = document.querySelectorAll('[class*="show-more"], [class*="load-more"], button[class*="more"]');
  for (const btn of moreButtons) {
    try { btn.click(); await new Promise(r => setTimeout(r, 2000)); } catch(e) {}
  }

  // Extract review cards — Practo uses .feedback--item class
  const cards = document.querySelectorAll('.pure-g.feedback--item, [class*="feedback--item"], [data-qa-id="review-card"]');
  
  cards.forEach(card => {
    // Review text from .feedback__content or generic content divs
    const contentEls = card.querySelectorAll('.feedback__content, [class*="review-text"], [class*="feedback-text"]');
    let text = '';
    let title = '';
    contentEls.forEach(el => {
      const t = el.textContent.trim();
      if (t.length > text.length) text = t;
      if (el.classList.contains('u-bold') && t.length < 200) title = t;
    });

    // Fallback: grab all text from the card if no specific content found
    if (!text || text.length < 10) {
      const allText = card.textContent.trim();
      if (allText.length > 20) text = allText.slice(0, 2000);
    }

    if (!text || text.length < 10) return;

    // Author name
    const authorEl = card.querySelector('.feedback__icon + div, [class*="reviewer-name"], [class*="patient-name"], [class*="name"]');
    const authorName = authorEl ? authorEl.textContent.trim().split('\\n')[0] : undefined;

    // Date / context
    const contextEl = card.querySelector('.feedback__context, [class*="review-date"], [class*="timestamp"]');
    const contextText = contextEl ? contextEl.textContent.trim() : '';
    const dateMatch = contextText.match(/(\\d+\\s+(?:year|month|week|day|hour)s?\\s+ago)/i);
    const publishedAt = dateMatch ? dateMatch[1] : undefined;

    // Doctor tagged
    const doctorEl = card.querySelector('[class*="doctor-name"], [class*="feedback__doctor"]');
    const doctorName = doctorEl ? doctorEl.textContent.trim() : undefined;

    // Treatment tags
    const treatmentEls = card.querySelectorAll('[class*="treatment-tag"], [class*="tag"]');
    const treatments = [...treatmentEls].map(el => el.textContent.trim()).filter(t => t.length > 0 && t.length < 80);

    // Rating: Practo uses "I recommend the doctor" pattern or star icons
    const recommendEl = card.querySelector('[class*="recommend"], [class*="thumbs-up"]');
    const hasRecommend = recommendEl ? recommendEl.textContent.toLowerCase().includes('recommend') : false;
    
    // Check for star rating
    const starsEl = card.querySelector('[class*="star-rating"], [class*="rating"]');
    let rating = undefined;
    if (starsEl) {
      const starText = starsEl.getAttribute('aria-label') || starsEl.textContent;
      const starMatch = starText.match(/(\\d+(\\.\\d+)?)/);
      if (starMatch) rating = parseFloat(starMatch[1]);
    }
    if (!rating && hasRecommend) rating = 5;

    results.push({
      text: text.slice(0, 3000),
      rating,
      ratingScale: 5,
      authorName: authorName?.slice(0, 100),
      publishedAt,
      title: title || undefined,
      doctorName,
      treatments: treatments.slice(0, 5),
      sourceUrl: window.location.href,
      language: 'en',
    });
  });

  return results;
}
`;

// ─── Connector Class ─────────────────────────────────────────────────────────

const WEB_SCRAPER_ACTOR = 'apify/web-scraper';

export class ApifyPractoReviewConnector {
  private readonly client: ApifyClient;
  private readonly memoryMbytes: number;

  constructor(private readonly config: PractoReviewConnectorConfig) {
    if (!config.apifyApiToken) {
      throw new Error('APIFY_API_TOKEN is required for ApifyPractoReviewConnector');
    }

    this.client = new ApifyClient({
      token: config.apifyApiToken,
      maxRetries: 3,
      minDelayBetweenRetriesMillis: 1000,
    });

    this.memoryMbytes = config.memoryMbytes ?? 1024;
  }

  async fetch(input: PractoReviewConnectorInput): Promise<PractoReviewConnectorResult> {
    if (!input.hospitalName?.trim()) {
      throw new Error('hospitalName is required');
    }
    if (!input.city?.trim()) {
      throw new Error('city is required for Practo review scraping');
    }

    const citySlug = slugify(input.city);
    const hospitalSlug = input.hospitalSlug ?? slugify(input.hospitalName);

    // Practo hospital review URL pattern
    const directUrl = `https://www.practo.com/${citySlug}/hospital/${hospitalSlug}/reviews`;
    const searchUrl = `https://www.practo.com/${citySlug}/search?q=${encodeURIComponent(input.hospitalName)}&type=hospital`;

    const warnings: string[] = [];

    const actorInput = {
      startUrls: [
        { url: directUrl, userData: JSON.stringify({ maxScrolls: input.maxScrolls ?? 8 }) },
        { url: searchUrl, userData: JSON.stringify({ maxScrolls: 3 }) },
      ],
      pageFunction: PRACTO_REVIEW_PAGE_FUNCTION,
      proxyConfiguration: { useApifyProxy: true },
      maxConcurrency: 2,
      maxRequestRetries: 2,
      maxPagesPerCrawl: 5,
      waitUntil: ['networkidle2'],
    };

    const run = await this.client.actor(WEB_SCRAPER_ACTOR).call(actorInput, {
      memory: this.memoryMbytes,
      waitSecs: 300,
    });

    if (!run.defaultDatasetId) {
      throw new Error(`Web scraper completed without dataset ID`);
    }

    const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

    // The web scraper returns array-of-arrays (each page returns an array of results)
    const flatItems = (Array.isArray(items) ? items : []).flatMap((item) =>
      Array.isArray(item) ? item : [item],
    ) as Array<Record<string, unknown>>;

    if (flatItems.length === 0) {
      warnings.push(`No reviews found at ${directUrl} — the hospital slug may be wrong or Practo may have changed their DOM`);
    }

    const evidence: PractoReviewEvidence[] = [];
    const seenTexts = new Set<string>();

    for (const item of flatItems) {
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!text || text.length < 10) continue;

      // Dedupe by text content
      const textHash = sha256(text).slice(0, 16);
      if (seenTexts.has(textHash)) continue;
      seenTexts.add(textHash);

      const id = stableId([input.hospitalSeedId, 'PRACTO', text.slice(0, 100)]);
      const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl : directUrl;

      const rating = typeof item.rating === 'number' && item.rating >= 1 && item.rating <= 5
        ? item.rating
        : undefined;

      evidence.push({
        id,
        hospitalSeedId: input.hospitalSeedId,
        source: 'PRACTO',
        sourceType: 'review',
        sourceUrl,
        collectedAt: new Date().toISOString(),
        publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : undefined,
        title: typeof item.title === 'string' ? item.title : undefined,
        text,
        authorName: typeof item.authorName === 'string' ? item.authorName : undefined,
        rating,
        ratingScale: 5,
        platformMetadata: {
          doctorName: item.doctorName,
          treatments: item.treatments,
        },
        acquisition: {
          connectorName: 'ApifyPractoReviewConnector',
          connectorVersion: '1.0.0',
          runId: input.runId,
          method: 'managed_scraper',
          externalRunId: run.id,
          externalDatasetId: run.defaultDatasetId,
        },
        processingStatus: 'ready_for_classification',
      });
    }

    return {
      runId: input.runId,
      actorRunId: run.id,
      datasetId: run.defaultDatasetId,
      totalReviews: evidence.length,
      reviewPageUrl: directUrl,
      evidence,
      warnings,
    };
  }
}
