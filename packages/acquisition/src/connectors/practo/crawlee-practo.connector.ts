import crypto from 'node:crypto';
import { Configuration, PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import { loadCrawleeConnectorConfig } from '../crawlee/crawlee.config.js';
import type { CrawleeScrapedPage } from '../crawlee/crawlee.types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PractoCrawleeInput {
  runId: string;
  hospitalSeedId: string;
  hospitalName: string;
  city: string;
  /** Override auto-generated slug */
  hospitalSlug?: string;
  /** Max "Load More" clicks (each loads ~10 reviews). Default 100 = ~1000 reviews max */
  maxRequests?: number;
}

export interface PractoReviewRecord {
  id: string;
  hospitalSeedId: string;
  source: 'PRACTO';
  sourceType: 'review';
  sourceUrl: string;
  title?: string;
  text: string;
  authorName?: string;
  rating?: number;
  ratingScale: 5;
  publishedAt?: string;
  doctorName?: string;
  treatments?: string[];
  collectedAt: string;
  acquisition: {
    connectorName: string;
    connectorVersion: string;
    runId: string;
    method: 'browser';
  };
  processingStatus: 'ready_for_classification' | 'raw_collected';
}

export interface PractoCrawleeResult {
  runId: string;
  totalReviews: number;
  reviewPageUrl: string;
  reviews: PractoReviewRecord[];
  warnings: string[];
  failedUrls: string[];
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

// ─── Connector ───────────────────────────────────────────────────────────────

export class CrawleePractoConnector {
  async fetch(input: PractoCrawleeInput): Promise<PractoCrawleeResult> {
    if (!input.hospitalName?.trim()) {
      throw new Error('hospitalName is required');
    }
    if (!input.city?.trim()) {
      throw new Error('city is required for Practo crawling');
    }

    const config = loadCrawleeConnectorConfig();
    const citySlug = slugify(input.city);
    const hospitalSlug = input.hospitalSlug ?? slugify(input.hospitalName);
    const reviewUrl = `https://www.practo.com/${citySlug}/hospital/${hospitalSlug}/reviews`;

    const warnings: string[] = [];
    const failedUrls: string[] = [];
    const allPages: CrawleeScrapedPage[] = [];

    const maxLoadMoreClicks = input.maxRequests ?? 100;

    const configuration = new Configuration({
      storageDir: config.storageDir,
    });

    const proxyConfiguration =
      config.useProxy && config.proxyUrls.length > 0
        ? new ProxyConfiguration({ proxyUrls: config.proxyUrls })
        : undefined;

    const crawler = new PlaywrightCrawler(
      {
        maxRequestsPerCrawl: 1, // single page — we load all reviews via scroll/click
        requestHandlerTimeoutSecs: Math.max(config.requestHandlerTimeoutSecs, maxLoadMoreClicks * 4),
        navigationTimeoutSecs: config.navigationTimeoutSecs,
        proxyConfiguration,
        launchContext: {
          launchOptions: { headless: config.headless },
        },

        async requestHandler({ request, page, log }) {
          log.info(`Crawling ${request.url}`);

          // Wait for crypto challenge to auto-solve (Practo uses Kasada-style PoW)
          log.info('Waiting for challenge to resolve...');
          await page.waitForFunction(
            () => !document.title.includes('Challenge'),
            { timeout: 45_000 },
          ).catch(() => {
            log.warning('Challenge may not have resolved — continuing anyway');
          });
          await page.waitForTimeout(2000);
          log.info(`Page title: ${await page.title()}`);

          // Wait for reviews section to appear
          await page.waitForSelector(
            '.feedback--item, [data-qa-id="review-card"], .review-card, [class*="feedback"]',
            { timeout: 15_000 },
          ).catch(() => {
            log.warning('Could not find review cards selector initially');
          });

          // Repeatedly click "More" button to load all reviews
          let clickCount = 0;
          let lastReviewCount = 0;
          let staleRounds = 0;

          for (let i = 0; i < maxLoadMoreClicks; i++) {
            // Try clicking the Practo "More" pagination button
            const moreBtn = page.locator(
              '.feedback__pagination-btn, button:has-text("More"):not(:has-text("Read more"))',
            ).first();

            const btnVisible = await moreBtn.isVisible().catch(() => false);
            if (!btnVisible) {
              // No more button — we've loaded everything
              log.info(`"More" button no longer visible after ${clickCount} clicks. All reviews loaded.`);
              break;
            }

            await moreBtn.click().catch(() => {});
            clickCount++;
            await page.waitForTimeout(1500);

            // Count reviews periodically
            if (clickCount % 10 === 0) {
              const currentCount = await page.locator('.feedback--item, [class*="feedback--item"]').count().catch(() => 0);
              log.info(`Progress: ${currentCount} reviews after ${clickCount} clicks`);

              if (currentCount === lastReviewCount) {
                staleRounds++;
                if (staleRounds >= 2) {
                  log.info(`No new reviews after ${staleRounds * 10} clicks. Done.`);
                  break;
                }
              } else {
                staleRounds = 0;
                lastReviewCount = currentCount;
              }
            }
          }

          log.info(`Finished loading. Clicked "Load More" ${clickCount} times, ~${lastReviewCount} review cards on page.`);

          // Extract all reviews from fully loaded page
          const html = await page.content().catch(() => undefined);
          const loadedUrl = page.url();

          const reviews = parsePractoReviews(html, loadedUrl ?? request.url);

          if (reviews.length > 0) {
            allPages.push(...reviews);
            log.info(`Extracted ${reviews.length} structured reviews`);
          } else {
            // Fallback: raw text
            const text = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
            const cleanText = text?.replace(/\s+/g, ' ').trim();
            if (cleanText && cleanText.length > 50) {
              allPages.push({
                url: loadedUrl ?? request.url,
                loadedUrl,
                title: await page.title().catch(() => undefined),
                text: cleanText,
                sourceType: 'review',
                metadata: { fallback: true },
              });
            }
            warnings.push('No structured review cards found, used text fallback');
          }
        },

        failedRequestHandler({ request, error }) {
          failedUrls.push(request.url);
          warnings.push(`Failed: ${request.url}: ${error instanceof Error ? error.message : String(error)}`);
        },
      },
      configuration,
    );

    await crawler.run([reviewUrl]);

    // Convert scraped pages to typed review records
    const seenTexts = new Set<string>();
    const reviews: PractoReviewRecord[] = [];

    for (const page of allPages) {
      const text = page.text?.trim();
      if (!text || text.length < 10) continue;

      const textHash = sha256(text).slice(0, 16);
      if (seenTexts.has(textHash)) continue;
      seenTexts.add(textHash);

      const id = sha256([input.hospitalSeedId, 'PRACTO', text.slice(0, 100)].join('|')).slice(0, 32);

      reviews.push({
        id,
        hospitalSeedId: input.hospitalSeedId,
        source: 'PRACTO',
        sourceType: 'review',
        sourceUrl: page.url,
        title: page.title,
        text,
        authorName: page.metadata?.authorName as string | undefined,
        rating: page.metadata?.rating as number | undefined,
        ratingScale: 5,
        publishedAt: page.metadata?.publishedAt as string | undefined,
        doctorName: page.metadata?.doctorName as string | undefined,
        treatments: page.metadata?.treatments as string[] | undefined,
        collectedAt: new Date().toISOString(),
        acquisition: {
          connectorName: 'CrawleePractoConnector',
          connectorVersion: '2.0.0',
          runId: input.runId,
          method: 'browser',
        },
        processingStatus: 'ready_for_classification',
      });
    }

    return {
      runId: input.runId,
      totalReviews: reviews.length,
      reviewPageUrl: reviewUrl,
      reviews,
      warnings,
      failedUrls,
    };
  }
}

// ─── HTML Parsing (runs server-side after Playwright captures page) ──────────

function parsePractoReviews(html: string | undefined, pageUrl: string): CrawleeScrapedPage[] {
  if (!html) return [];

  const { load } = await_cheerio();
  const $ = load(html);
  const results: CrawleeScrapedPage[] = [];

  // Practo review card selectors
  const cardSelectors = [
    '.pure-g.feedback--item',
    '[class*="feedback--item"]',
    '[data-qa-id="review-card"]',
    '.review-card',
  ];

  const cards = $(cardSelectors.join(', '));

  cards.each((_, card) => {
    const $card = $(card);

    // Extract review text
    let text = '';
    let title = '';

    $card.find('.feedback__content, [class*="review-text"], [class*="feedback-text"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > text.length) text = t;
      if ($(el).hasClass('u-bold') && t.length < 200) title = t;
    });

    if (!text || text.length < 10) {
      text = $card.text().trim();
    }

    if (!text || text.length < 10) return;

    // Author
    const authorName = $card
      .find('.feedback__icon + div, [class*="reviewer-name"], [class*="patient-name"]')
      .first()
      .text()
      .trim()
      .split('\n')[0] || undefined;

    // Date
    const contextText = $card.find('.feedback__context, [class*="review-date"], [class*="timestamp"]').text().trim();
    const dateMatch = contextText.match(/(\d+\s+(?:year|month|week|day|hour)s?\s+ago)/i);
    const publishedAt = dateMatch ? dateMatch[1] : undefined;

    // Doctor
    const doctorName = $card.find('[class*="doctor-name"], [class*="feedback__doctor"]').first().text().trim() || undefined;

    // Rating
    const recommendEl = $card.find('[class*="recommend"], [class*="thumbs-up"]');
    const hasRecommend = recommendEl.text().toLowerCase().includes('recommend');
    let rating: number | undefined;
    const starsEl = $card.find('[class*="star-rating"], [class*="rating"]');
    if (starsEl.length) {
      const starText = starsEl.attr('aria-label') || starsEl.text();
      const starMatch = starText.match(/(\d+(\.\d+)?)/);
      if (starMatch) rating = parseFloat(starMatch[1]);
    }
    if (!rating && hasRecommend) rating = 5;

    // Treatment tags
    const treatments: string[] = [];
    $card.find('[class*="treatment-tag"], [class*="tag"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 0 && t.length < 80) treatments.push(t);
    });

    results.push({
      url: pageUrl,
      title: title || undefined,
      text: text.slice(0, 3000),
      sourceType: 'review',
      metadata: {
        authorName,
        publishedAt,
        doctorName,
        treatments: treatments.slice(0, 5),
        rating,
      },
    });
  });

  return results;
}

// Lazy cheerio import
let _cheerio: typeof import('cheerio') | undefined;
function await_cheerio() {
  if (!_cheerio) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _cheerio = require('cheerio') as typeof import('cheerio');
  }
  return _cheerio;
}
