import crypto from 'node:crypto';
import { loadCrawleeConnectorConfig } from '../crawlee/crawlee.config.js';
import { runPlaywrightCrawl, type CrawleePageExtractor } from '../crawlee/crawlee-runner.js';
import type { CrawleeScrapedPage, CrawleeScrapeInput } from '../crawlee/crawlee.types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MouthShutCrawleeInput {
  runId: string;
  hospitalSeedId: string;
  hospitalName: string;
  city?: string;
  startUrls: string[];
  maxRequests?: number;
}

export interface MouthShutReviewRecord {
  id: string;
  hospitalSeedId: string;
  source: 'MOUTHSHUT';
  sourceType: 'review';
  sourceUrl: string;
  title?: string;
  text: string;
  authorName?: string;
  rating?: number;
  ratingScale: 5;
  publishedAt?: string;
  collectedAt: string;
  acquisition: {
    connectorName: string;
    connectorVersion: string;
    runId: string;
    method: 'browser';
  };
  processingStatus: 'raw_collected' | 'ready_for_classification' | 'needs_manual_review';
  rawQualityFlags: string[];
}

export interface MouthShutCrawleeResult {
  runId: string;
  totalReviews: number;
  reviews: MouthShutReviewRecord[];
  warnings: string[];
  failedUrls: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function looksRelevantToHospital(text: string | undefined, hospitalName: string): boolean {
  if (!text) return false;
  const normalizedText = text.toLowerCase();
  const importantTokens = hospitalName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !['hospital', 'clinic', 'healthcare', 'medical'].includes(token));

  if (importantTokens.length === 0) return true;
  return importantTokens.some((token) => normalizedText.includes(token));
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class CrawleeMouthShutConnector {
  async fetch(input: MouthShutCrawleeInput): Promise<MouthShutCrawleeResult> {
    if (!input.startUrls.length) {
      throw new Error('MouthShut connector requires at least one start URL');
    }

    const config = loadCrawleeConnectorConfig();

    const extractor: CrawleePageExtractor = {
      sourceName: 'mouthshut',
      sourceType: 'review',

      async extract({ requestUrl, loadedUrl, title, text, html }) {
        const reviews = parseMouthShutReviews(html, loadedUrl ?? requestUrl);

        if (reviews.length > 0) {
          return reviews;
        }

        // Fallback: whole page text
        const cleanText = text?.replace(/\s+/g, ' ').trim();
        if (cleanText && cleanText.length > 50) {
          return {
            url: loadedUrl ?? requestUrl,
            loadedUrl,
            title: title?.trim(),
            text: cleanText,
            sourceType: 'review',
            metadata: { fallback: true, textLength: cleanText.length },
          };
        }

        return null;
      },
    };

    const crawlInput: CrawleeScrapeInput = {
      runId: input.runId,
      hospitalSeedId: input.hospitalSeedId,
      hospitalName: input.hospitalName,
      city: input.city,
      startUrls: input.startUrls,
      maxRequests: input.maxRequests ?? 10,
    };

    const result = await runPlaywrightCrawl(crawlInput, config, extractor);

    // Convert to typed records
    const seenTexts = new Set<string>();
    const reviews: MouthShutReviewRecord[] = [];

    for (const page of result.pages) {
      const text = page.text?.trim();
      if (!text || text.length < 10) continue;

      const textHash = sha256(text).slice(0, 16);
      if (seenTexts.has(textHash)) continue;
      seenTexts.add(textHash);

      const id = sha256([input.hospitalSeedId, 'MOUTHSHUT', text.slice(0, 100)].join('|')).slice(0, 32);
      const relevant = looksRelevantToHospital(text, input.hospitalName);

      reviews.push({
        id,
        hospitalSeedId: input.hospitalSeedId,
        source: 'MOUTHSHUT',
        sourceType: 'review',
        sourceUrl: page.url,
        title: page.title,
        text,
        authorName: page.metadata?.authorName as string | undefined,
        rating: page.metadata?.rating as number | undefined,
        ratingScale: 5,
        publishedAt: page.metadata?.publishedAt as string | undefined,
        collectedAt: new Date().toISOString(),
        acquisition: {
          connectorName: 'CrawleeMouthShutConnector',
          connectorVersion: '1.0.0',
          runId: input.runId,
          method: 'browser',
        },
        processingStatus: relevant ? 'ready_for_classification' : 'needs_manual_review',
        rawQualityFlags: relevant ? [] : ['hospital_relevance_uncertain'],
      });
    }

    return {
      runId: input.runId,
      totalReviews: reviews.length,
      reviews,
      warnings: result.warnings,
      failedUrls: result.failedUrls,
    };
  }
}

// ─── HTML Parsing ────────────────────────────────────────────────────────────

function parseMouthShutReviews(html: string | undefined, pageUrl: string): CrawleeScrapedPage[] {
  if (!html) return [];

  const { load } = await_cheerio();
  const $ = load(html);
  const results: CrawleeScrapedPage[] = [];

  // MouthShut review card selectors
  const cards = $('.review-article, .col-12.reivew, [class*="review-box"], .review_box');

  cards.each((_, card) => {
    const $card = $(card);

    // Review title
    const title = $card.find('.review-title, h2 a, [class*="review-heading"]').first().text().trim() || undefined;

    // Review text
    let text = $card.find('.review-body, .more, [class*="review-content"], .review_desc').text().trim();
    if (!text || text.length < 10) {
      text = $card.text().trim();
    }
    if (!text || text.length < 10) return;

    // Author
    const authorName = $card.find('.reviewer-name, [class*="user-name"], .user_name').first().text().trim() || undefined;

    // Date
    const dateText = $card.find('.review-date, [class*="date"], time').first().text().trim();
    const publishedAt = dateText || undefined;

    // Rating (MouthShut uses star images or rating text)
    let rating: number | undefined;
    const ratingEl = $card.find('[class*="rating"], .star-rating, .overall-rating');
    if (ratingEl.length) {
      const ratingText = ratingEl.attr('title') || ratingEl.text();
      const ratingMatch = ratingText.match(/(\d+(\.\d+)?)/);
      if (ratingMatch) {
        const val = parseFloat(ratingMatch[1]);
        if (val >= 1 && val <= 5) rating = val;
        else if (val >= 1 && val <= 10) rating = Math.round((val / 2) * 10) / 10;
      }
    }

    results.push({
      url: pageUrl,
      title,
      text: text.slice(0, 3000),
      sourceType: 'review',
      metadata: {
        authorName,
        publishedAt,
        rating,
      },
    });
  });

  return results;
}

let _cheerio: typeof import('cheerio') | undefined;
function await_cheerio() {
  if (!_cheerio) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _cheerio = require('cheerio') as typeof import('cheerio');
  }
  return _cheerio;
}
