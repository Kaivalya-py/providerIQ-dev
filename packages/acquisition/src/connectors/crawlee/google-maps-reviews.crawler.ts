/**
 * Open-source Google Maps review scraper using Playwright.
 * No API keys required — directly scrolls the reviews panel.
 *
 * Flow:
 *   1. Navigate to Google Maps place URL
 *   2. Click "Reviews" tab (with retries)
 *   3. Sort by chosen order
 *   4. Scroll reviews panel until all loaded (or maxReviews reached)
 *   5. Extract review cards into RawEvidence format
 */
import { chromium, type Browser, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { RawEvidence } from '../../types/raw-evidence.types.js';

export interface GoogleMapsCrawlerInput {
  hospitalSeedId: string;
  hospitalName: string;
  city: string;
  googleMapsUrl: string;
  maxReviews?: number;
  sortOrder?: 'newest' | 'mostRelevant' | 'highestRating' | 'lowestRating';
  headless?: boolean;
}

export interface GoogleMapsCrawlerResult {
  records: RawEvidence[];
  totalFound: number;
  placeTitle?: string;
  totalReviewsOnPage?: number;
}

const SORT_MENU_TEXT: Record<string, string> = {
  newest: 'Newest',
  mostRelevant: 'Most relevant',
  highestRating: 'Highest rating',
  lowestRating: 'Lowest rating',
};

export class GoogleMapsReviewsCrawler {
  private browser: Browser | null = null;

  async crawl(input: GoogleMapsCrawlerInput): Promise<GoogleMapsCrawlerResult> {
    const maxReviews = input.maxReviews ?? 5000;
    const sortOrder = input.sortOrder ?? 'newest';
    const headless = input.headless ?? true;

    this.browser = await chromium.launch({ headless });
    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    try {
      // 1. Navigate to place
      console.log(`    [Crawler] Navigating to ${input.googleMapsUrl}`);
      await page.goto(input.googleMapsUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForSelector('h1', { timeout: 30_000 });
      await page.waitForTimeout(4000); // Give JS time to hydrate

      // Accept cookies if prompted
      await page.locator('button:has-text("Accept all")').click({ timeout: 2000 }).catch(() => {});

      const placeTitle = await page.locator('h1').first().textContent().catch(() => 'unknown');
      console.log(`    [Crawler] Place: ${placeTitle}`);

      // 2. Navigate to reviews — try multiple approaches
      await this.openReviewsTab(page);

      // 3. Wait for the scrollable panel with reviews to appear
      const scrollPanel = await this.findScrollPanel(page);
      if (!scrollPanel) {
        console.log(`    [Crawler] ERROR: Could not find reviews scroll panel after retries`);
        return { records: [], totalFound: 0, placeTitle: placeTitle ?? undefined };
      }

      // 4. Get total review count
      const totalReviewsOnPage = await this.extractTotalReviewCount(page);
      console.log(`    [Crawler] Total reviews on page: ${totalReviewsOnPage ?? 'unknown'}`);

      // 5. Sort reviews
      await this.setSortOrder(page, sortOrder);

      // 6. Scroll and collect
      const records = await this.scrollAndExtract(page, scrollPanel, input, maxReviews);

      return {
        records,
        totalFound: records.length,
        placeTitle: placeTitle ?? undefined,
        totalReviewsOnPage,
      };
    } finally {
      await this.browser.close();
      this.browser = null;
    }
  }

  /** Try multiple approaches to open the Reviews tab */
  private async openReviewsTab(page: Page): Promise<void> {
    // Approach 1: Click the Reviews tab button
    const tabSelectors = [
      'button[role="tab"]:has-text("Reviews")',
      'button[aria-label*="Reviews"]',
      '[role="tablist"] button:nth-child(2)', // Reviews is usually the 2nd tab
    ];

    for (const sel of tabSelectors) {
      const tab = page.locator(sel).first();
      if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(2000);
        // Verify reviews loaded
        const hasReviews = await page.locator('div.jftiEf').first().isVisible({ timeout: 3000 }).catch(() => false);
        if (hasReviews) {
          console.log(`    [Crawler] Reviews tab opened via: ${sel}`);
          return;
        }
      }
    }

    // Approach 2: Click on the review count text (e.g., "3,388 reviews")
    const reviewLink = page.locator('button:has-text("reviews")').first();
    if (await reviewLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await reviewLink.click();
      await page.waitForTimeout(2000);
      const hasReviews = await page.locator('div.jftiEf').first().isVisible({ timeout: 3000 }).catch(() => false);
      if (hasReviews) {
        console.log(`    [Crawler] Reviews opened via review count link`);
        return;
      }
    }

    // Approach 3: Maybe already on reviews view (URL contains reviews)
    const hasReviews = await page.locator('div.jftiEf').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (hasReviews) {
      console.log(`    [Crawler] Already on reviews view`);
      return;
    }

    console.log(`    [Crawler] WARNING: Could not navigate to reviews tab`);
  }

  /** Find the scrollable container that holds reviews */
  private async findScrollPanel(page: Page): Promise<string | null> {
    // Wait for at least one review card to appear
    await page.locator('div.jftiEf').first().waitFor({ timeout: 10_000 }).catch(() => {});

    // Find the scrollable div that contains the review cards
    const panelSelector = await page.evaluate(() => {
      // Walk up from a review card to find its scrollable ancestor
      const reviewCard = document.querySelector('div.jftiEf');
      if (!reviewCard) return null;

      let el: HTMLElement | null = reviewCard.parentElement as HTMLElement;
      while (el) {
        const style = getComputedStyle(el);
        const isScrollable = el.scrollHeight > el.clientHeight + 50
          && (style.overflowY === 'auto' || style.overflowY === 'scroll');
        if (isScrollable) {
          // Build a unique selector for this element
          if (el.id) return `#${el.id}`;
          const cls = Array.from(el.classList).join('.');
          if (cls) return `div.${cls}`;
          return null;
        }
        el = el.parentElement as HTMLElement;
      }
      return null;
    });

    if (panelSelector) {
      console.log(`    [Crawler] Found scroll panel: ${panelSelector}`);
      return panelSelector;
    }

    // Fallback: use the known Google Maps class
    const fallback = 'div.m6QErb.DxyBCb.kA9KIf.dS8AEf';
    const isVisible = await page.locator(fallback).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      console.log(`    [Crawler] Using fallback scroll panel`);
      return fallback;
    }

    return null;
  }

  private async extractTotalReviewCount(page: Page): Promise<number | undefined> {
    const allText = await page.locator('body').innerText().catch(() => '');
    const match = allText.match(/([\d,]+)\s*reviews?\s/i);
    if (match) {
      return parseInt(match[1]!.replace(/,/g, ''), 10);
    }
    return undefined;
  }

  private async setSortOrder(page: Page, sortOrder: string): Promise<void> {
    const sortLabel = SORT_MENU_TEXT[sortOrder] ?? 'Newest';

    // The sort button usually has aria-label "Sort reviews" or contains "Most relevant" text
    const sortTriggers = [
      'button[aria-label="Sort reviews"]',
      'button[data-value="Sort"]',
      'button:has-text("Most relevant")',
      'button:has-text("Sort")',
    ];

    for (const sel of sortTriggers) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);

        // Look for menu items
        const menuItem = page.locator(`[role="menuitemradio"]:has-text("${sortLabel}"), [role="option"]:has-text("${sortLabel}"), div[data-index]:has-text("${sortLabel}")`).first();
        if (await menuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await menuItem.click();
          await page.waitForTimeout(2000);
          console.log(`    [Crawler] Sorted by: ${sortLabel}`);
          return;
        }
        // Close menu if option not found
        await page.keyboard.press('Escape');
        break;
      }
    }
    console.log(`    [Crawler] Sort not available, using default order`);
  }

  private async scrollAndExtract(
    page: Page,
    panelSelector: string,
    input: GoogleMapsCrawlerInput,
    maxReviews: number
  ): Promise<RawEvidence[]> {
    const scrollPanel = page.locator(panelSelector).first();

    let previousCount = 0;
    let stuckCount = 0;
    const maxStuck = 10;

    while (stuckCount < maxStuck) {
      const currentCount = await page.locator('div.jftiEf[aria-label]').count();

      if (currentCount >= maxReviews) {
        console.log(`    [Crawler] Reached maxReviews (${maxReviews}), stopping`);
        break;
      }

      if (currentCount === previousCount) {
        stuckCount++;
      } else {
        stuckCount = 0;
        if (currentCount % 50 === 0 || currentCount - previousCount > 10) {
          console.log(`    [Crawler] Loaded ${currentCount} reviews...`);
        }
      }
      previousCount = currentCount;

      // Scroll the panel
      await scrollPanel.evaluate((el) => {
        el.scrollBy(0, 3000);
      }).catch(async () => {
        // Fallback: mouse wheel on the panel
        const box = await scrollPanel.boundingBox();
        if (box) {
          await page.mouse.wheel(0, 2000);
        }
      });

      // Randomized delay to avoid detection
      await page.waitForTimeout(1000 + Math.random() * 500);
    }

    const finalCount = await page.locator('div.jftiEf[aria-label]').count();
    console.log(`    [Crawler] Scroll done. ${finalCount} review cards loaded.`);

    // Expand truncated reviews (click "More" buttons)
    await this.expandTruncatedReviews(page);

    // Extract
    return this.extractReviews(page, input);
  }

  private async expandTruncatedReviews(page: Page): Promise<void> {
    // Google Maps uses different "More" / "See more" buttons
    const moreButtons = page.locator('button.w8nwRe.kyuRq');
    const count = await moreButtons.count();
    if (count > 0) {
      console.log(`    [Crawler] Expanding ${count} truncated reviews...`);
      // Click them in batches to avoid overwhelming
      for (let i = 0; i < count; i++) {
        await moreButtons.nth(i).click({ timeout: 500 }).catch(() => {});
        if (i % 50 === 49) await page.waitForTimeout(200);
      }
      await page.waitForTimeout(300);
    }
  }

  private async extractReviews(page: Page, input: GoogleMapsCrawlerInput): Promise<RawEvidence[]> {
    // Top-level review containers (each has aria-label = author name)
    const reviewCards = page.locator('div.jftiEf[aria-label]');
    const count = await reviewCards.count();
    console.log(`    [Crawler] Extracting ${count} review cards...`);

    const records: RawEvidence[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < count; i++) {
      try {
        const card = reviewCards.nth(i);
        const reviewData = await card.evaluate((el) => {
          // Extract review ID
          const reviewId = el.getAttribute('data-review-id') ??
            el.querySelector('[data-review-id]')?.getAttribute('data-review-id') ?? '';

          // Author name (from .d4r55 only, not the container)
          const authorEl = el.querySelector('.d4r55');
          const authorName = authorEl?.textContent?.trim() ?? '';

          // Rating (aria-label like "5 stars" or star elements)
          const ratingEl = el.querySelector('[role="img"][aria-label*="star"]');
          const ratingMatch = ratingEl?.getAttribute('aria-label')?.match(/(\d)/);
          const rating = ratingMatch ? parseInt(ratingMatch[1]!, 10) : null;

          // Review text (full body, may need "More" click first)
          const textEl = el.querySelector('.wiI7pd');
          const text = textEl?.textContent?.trim() ?? '';

          // Date/time (relative like "2 months ago")
          const timeEl = el.querySelector('.rsqaWe');
          const timeText = timeEl?.textContent?.trim() ?? '';

          // Response from owner
          const responseEl = el.querySelector('.CDe7pd');
          const ownerResponse = responseEl?.textContent?.trim() ?? undefined;

          return { reviewId, authorName, rating, text, timeText, ownerResponse };
        });

        if (!reviewData.text && !reviewData.rating) continue;

        const sourceRecordId = reviewData.reviewId || createHash('sha256')
          .update(`${reviewData.authorName}|${reviewData.text?.slice(0, 50)}|${reviewData.timeText}`)
          .digest('hex')
          .slice(0, 24);

        const authorHash = reviewData.authorName
          ? createHash('sha256').update(reviewData.authorName).digest('hex').slice(0, 16)
          : undefined;

        records.push({
          id: randomUUID(),
          hospitalSeedId: input.hospitalSeedId,
          source: 'GOOGLE_MAPS_REVIEWS',
          sourceType: 'review',
          sourceUrl: input.googleMapsUrl,
          canonicalSourceUrl: input.googleMapsUrl,
          sourceRecordId,
          collectedAt: now,
          publishedAt: reviewData.timeText || now,
          text: reviewData.text || undefined,
          rating: reviewData.rating ?? undefined,
          ratingScale: 5,
          authorDisplayNameHash: authorHash,
          publicAuthorMetadata: {
            displayName: reviewData.authorName || undefined,
          },
          platformMetadata: {
            relativeTime: reviewData.timeText || undefined,
            ownerResponse: reviewData.ownerResponse,
            scrapedVia: 'playwright-crawler',
          },
          rawQualityFlags: [],
          piiFlags: {},
          processingStatus: 'raw_collected',
        });
      } catch {
        // Skip malformed cards
      }
    }

    return records;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
