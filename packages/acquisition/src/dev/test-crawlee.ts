/**
 * Dev script: test Crawlee-based connectors locally.
 *
 * Usage:
 *   CRAWLEE_TEST_MODE=practo npx tsx src/dev/test-crawlee.ts
 *   CRAWLEE_TEST_MODE=mouthshut npx tsx src/dev/test-crawlee.ts
 *
 * Env vars:
 *   CRAWLEE_TEST_MODE    - 'practo' | 'mouthshut' (default: practo)
 *   TEST_HOSPITAL_NAME   - Hospital name to search
 *   TEST_CITY            - City for Practo
 *   TEST_HOSPITAL_SLUG   - Override Practo slug
 *   TEST_START_URL       - Override start URL for MouthShut
 *   TEST_MAX_REQUESTS    - Max pages to crawl
 *   CRAWLEE_HEADLESS     - 'true' | 'false' (set to false to see the browser)
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { CrawleePractoConnector } from '../connectors/practo/crawlee-practo.connector.js';
import { CrawleeMouthShutConnector } from '../connectors/mouthshut/crawlee-mouthshut.connector.js';

async function main(): Promise<void> {
  const mode = process.env['CRAWLEE_TEST_MODE'] ?? 'practo';
  const runId = randomUUID();

  console.log(`🚀 Crawlee test — mode: ${mode}, runId: ${runId}`);
  console.log('');

  if (mode === 'practo') {
    const connector = new CrawleePractoConnector();

    const hospitalName = process.env['TEST_HOSPITAL_NAME'] ?? 'Manipal Hospital Whitefield';
    const city = process.env['TEST_CITY'] ?? 'Bangalore';
    const hospitalSlug = process.env['TEST_HOSPITAL_SLUG'] ?? 'manipal-hospital-whitefield';
    const maxRequests = Number(process.env['TEST_MAX_REQUESTS'] ?? 3);

    console.log(`📍 Hospital: ${hospitalName}`);
    console.log(`📍 City: ${city}`);
    console.log(`📍 Target: https://www.practo.com/${city.toLowerCase()}/hospital/${hospitalSlug}/reviews`);
    console.log('');

    const result = await connector.fetch({
      runId,
      hospitalSeedId: 'test-seed-manipal',
      hospitalName,
      city,
      hospitalSlug,
      maxRequests,
    });

    console.log('✅ Practo Crawlee result:');
    console.log(`   Total reviews: ${result.totalReviews}`);
    console.log(`   Failed URLs: ${result.failedUrls.length}`);
    console.log('');

    if (result.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      for (const w of result.warnings.slice(0, 5)) {
        console.log(`   - ${w}`);
      }
      console.log('');
    }

    console.log('📋 Reviews (first 5):');
    for (const review of result.reviews.slice(0, 5)) {
      console.log(`   [rating=${review.rating ?? '?'}/5] ${review.authorName ?? 'Anonymous'}`);
      console.log(`     ${review.text.slice(0, 150)}${review.text.length > 150 ? '...' : ''}`);
      if (review.publishedAt) console.log(`     date: ${review.publishedAt}`);
      if (review.doctorName) console.log(`     doctor: ${review.doctorName}`);
      console.log('');
    }

    if (result.reviews.length === 0) {
      console.log('   (no reviews extracted — selectors may need updating after inspecting the page)');
    }

    return;
  }

  if (mode === 'mouthshut') {
    const connector = new CrawleeMouthShutConnector();

    const hospitalName = process.env['TEST_HOSPITAL_NAME'] ?? 'Manipal Hospital';
    const startUrl = process.env['TEST_START_URL'] ?? 'https://www.mouthshut.com/product-reviews/Manipal-Hospital-Bangalore-reviews-925544024';
    const maxRequests = Number(process.env['TEST_MAX_REQUESTS'] ?? 3);

    console.log(`📍 Hospital: ${hospitalName}`);
    console.log(`📍 Start URL: ${startUrl}`);
    console.log('');

    const result = await connector.fetch({
      runId,
      hospitalSeedId: 'test-seed-manipal-ms',
      hospitalName,
      startUrls: [startUrl],
      maxRequests,
    });

    console.log('✅ MouthShut Crawlee result:');
    console.log(`   Total reviews: ${result.totalReviews}`);
    console.log(`   Failed URLs: ${result.failedUrls.length}`);
    console.log('');

    if (result.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      for (const w of result.warnings.slice(0, 5)) {
        console.log(`   - ${w}`);
      }
      console.log('');
    }

    console.log('📋 Reviews (first 5):');
    for (const review of result.reviews.slice(0, 5)) {
      console.log(`   [rating=${review.rating ?? '?'}/5] ${review.authorName ?? 'Anonymous'}`);
      console.log(`     ${review.text.slice(0, 150)}${review.text.length > 150 ? '...' : ''}`);
      if (review.publishedAt) console.log(`     date: ${review.publishedAt}`);
      console.log('');
    }

    if (result.reviews.length === 0) {
      console.log('   (no reviews extracted — selectors may need updating after inspecting the page)');
    }

    return;
  }

  throw new Error(`Unknown CRAWLEE_TEST_MODE: ${mode}. Use 'practo' or 'mouthshut'.`);
}

main().catch((error) => {
  console.error('💥 Error:', error);
  process.exit(1);
});
