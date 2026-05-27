import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { GoogleMapsReviewsCrawler } from '../connectors/crawlee/google-maps-reviews.crawler.js';

async function main() {
  const crawler = new GoogleMapsReviewsCrawler();
  const result = await crawler.crawl({
    hospitalSeedId: 'manipal-whitefield-blr',
    hospitalName: 'Manipal Hospital Whitefield',
    city: 'Bangalore',
    googleMapsUrl: 'https://maps.app.goo.gl/R3wrV3fH8XCdkaVp7',
    maxReviews: 100,
    sortOrder: 'newest',
    headless: true,
  });

  console.log('\n=== RESULT ===');
  console.log('Total found:', result.totalFound);
  console.log('Place:', result.placeTitle);
  console.log('Total on page:', result.totalReviewsOnPage);
  if (result.records.length > 0) {
    console.log('\nSample review:');
    console.log(JSON.stringify(result.records[0], null, 2));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
