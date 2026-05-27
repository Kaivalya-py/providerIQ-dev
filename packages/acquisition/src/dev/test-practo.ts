/**
 * Dev script: test Practo REVIEW connector locally.
 *
 * Usage:
 *   npx tsx src/dev/test-practo.ts
 *
 * Requires APIFY_API_TOKEN in your .env (monorepo root).
 * Uses apify/web-scraper to load Practo hospital review pages in a browser.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { ApifyPractoReviewConnector, type PractoReviewConnectorInput } from '../connectors/apify-practo.connector.js';

async function main() {
  const apifyApiToken = process.env['APIFY_API_TOKEN'];

  if (!apifyApiToken) {
    console.error('❌ APIFY_API_TOKEN not found in .env');
    process.exit(1);
  }

  const connector = new ApifyPractoReviewConnector({
    apifyApiToken,
    memoryMbytes: 1024,
  });

  const input: PractoReviewConnectorInput = {
    runId: randomUUID(),
    hospitalSeedId: 'test-seed-manipal-whitefield',
    hospitalName: 'Manipal Hospital Whitefield',
    city: 'Bangalore',
    hospitalSlug: 'manipal-hospital-whitefield',
    maxScrolls: 10,
  };

  console.log('🚀 Running Practo REVIEW connector with input:', JSON.stringify(input, null, 2));
  console.log(`📍 Target URL: https://www.practo.com/bangalore/hospital/manipal-hospital-whitefield/reviews`);
  console.log('');

  const result = await connector.fetch(input);

  console.log('✅ Practo review connector result:');
  console.log(`   Total reviews: ${result.totalReviews}`);
  console.log(`   Review page URL: ${result.reviewPageUrl}`);
  console.log(`   Actor run ID: ${result.actorRunId}`);
  console.log(`   Dataset ID: ${result.datasetId}`);
  console.log('');

  if (result.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const w of result.warnings) {
      console.log(`   - ${w}`);
    }
    console.log('');
  }

  console.log('📋 Reviews:');
  for (const ev of result.evidence.slice(0, 10)) {
    console.log(`   [rating=${ev.rating ?? '?'}/5] ${ev.authorName ?? 'Anonymous'}`);
    console.log(`     ${ev.text.slice(0, 120)}${ev.text.length > 120 ? '...' : ''}`);
    if (ev.publishedAt) console.log(`     published: ${ev.publishedAt}`);
    if (ev.platformMetadata?.doctorName) console.log(`     doctor: ${ev.platformMetadata.doctorName}`);
    console.log('');
  }

  if (result.evidence.length === 0) {
    console.log('   (no reviews extracted — the slug may be wrong or DOM selectors need updating)');
  }
}

main().catch((err) => {
  console.error('💥 Error:', err);
  process.exit(1);
});
