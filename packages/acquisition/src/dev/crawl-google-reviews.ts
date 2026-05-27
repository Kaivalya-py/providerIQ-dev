/**
 * Open-source batch Google Maps review crawler.
 * Uses Playwright directly — NO API keys, NO usage limits.
 *
 * Usage:
 *   npx tsx src/dev/crawl-google-reviews.ts
 *
 * Fetches ALL reviews for each hospital by scrolling the Google Maps reviews panel.
 * Stores to Neon with delta/upsert logic (re-running skips existing reviews).
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { GoogleMapsReviewsCrawler } from '../connectors/crawlee/google-maps-reviews.crawler.js';
import { NeonEvidenceStore } from '../storage/neon-evidence-store.js';

// ─── Hospital Seeds (10 hospitals across Indian cities) ──────────────────────

interface HospitalSeed {
  id: string;
  name: string;
  city: string;
  googleMapsUrl: string;
}

const HOSPITAL_SEEDS: HospitalSeed[] = [
  // Bangalore
  {
    id: 'manipal-whitefield-blr',
    name: 'Manipal Hospital Whitefield',
    city: 'Bangalore',
    googleMapsUrl: 'https://maps.app.goo.gl/R3wrV3fH8XCdkaVp7',
  },
  {
    id: 'narayana-health-blr',
    name: 'Narayana Health City',
    city: 'Bangalore',
    googleMapsUrl: 'https://maps.app.goo.gl/cqnPKnrLJnNBMyKe8',
  },
  // Mumbai
  {
    id: 'kokilaben-hospital-mum',
    name: 'Kokilaben Dhirubhai Ambani Hospital',
    city: 'Mumbai',
    googleMapsUrl: 'https://maps.app.goo.gl/2cV6MoR6rRpAXKZP8',
  },
  {
    id: 'lilavati-hospital-mum',
    name: 'Lilavati Hospital',
    city: 'Mumbai',
    googleMapsUrl: 'https://maps.app.goo.gl/fRvQsjPKJNRQYKfCA',
  },
  // Delhi/NCR
  {
    id: 'aiims-delhi',
    name: 'AIIMS Delhi',
    city: 'New Delhi',
    googleMapsUrl: 'https://maps.app.goo.gl/KxX1j9z4znEH7kZp6',
  },
  {
    id: 'max-saket-delhi',
    name: 'Max Super Speciality Hospital Saket',
    city: 'New Delhi',
    googleMapsUrl: 'https://maps.app.goo.gl/i8h1u5CPbGqJmBbE8',
  },
  // Chennai
  {
    id: 'apollo-greams-chennai',
    name: 'Apollo Hospital Greams Road',
    city: 'Chennai',
    googleMapsUrl: 'https://maps.app.goo.gl/iATqxthk4qrz7WbH6',
  },
  // Hyderabad
  {
    id: 'care-hospitals-hyd',
    name: 'CARE Hospitals Banjara Hills',
    city: 'Hyderabad',
    googleMapsUrl: 'https://maps.app.goo.gl/hDPnRGLSQvaBcVjw9',
  },
  // Kolkata
  {
    id: 'fortis-anandapur-kol',
    name: 'Fortis Hospital Anandapur',
    city: 'Kolkata',
    googleMapsUrl: 'https://maps.app.goo.gl/K7YDCNSHy3C7KSrr5',
  },
  // Pune
  {
    id: 'ruby-hall-pune',
    name: 'Ruby Hall Clinic',
    city: 'Pune',
    googleMapsUrl: 'https://maps.app.goo.gl/sHjkSAqBCwxB7t5g7',
  },
];

// ─── Config ──────────────────────────────────────────────────────────────────

const MAX_REVIEWS_PER_HOSPITAL = 5000;
const DELAY_BETWEEN_HOSPITALS_MS = 5000; // 5s between hospitals to be nice

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const neonUrl = process.env['NEON_RAW_EVIDENCE_URL'];
  if (!neonUrl) throw new Error('Missing NEON_RAW_EVIDENCE_URL in .env');

  const store = new NeonEvidenceStore({ connectionString: neonUrl });
  const crawler = new GoogleMapsReviewsCrawler();

  await store.ensureTable();
  console.log('Table ready.\n');
  console.log(`Processing ${HOSPITAL_SEEDS.length} hospitals (max ${MAX_REVIEWS_PER_HOSPITAL} reviews each)\n`);

  let totalNew = 0;
  const results: { name: string; city: string; existing: number; added: number; total: number }[] = [];

  for (let i = 0; i < HOSPITAL_SEEDS.length; i++) {
    const seed = HOSPITAL_SEEDS[i]!;
    console.log(`\n══ [${i + 1}/${HOSPITAL_SEEDS.length}] ${seed.name} (${seed.city}) ══`);

    const existingCount = await store.getCount(seed.id, 'GOOGLE_MAPS_REVIEWS');
    console.log(`  Existing reviews in DB: ${existingCount}`);

    try {
      const result = await crawler.crawl({
        hospitalSeedId: seed.id,
        hospitalName: seed.name,
        city: seed.city,
        googleMapsUrl: seed.googleMapsUrl,
        maxReviews: MAX_REVIEWS_PER_HOSPITAL,
        sortOrder: 'newest',
        headless: true,
      });

      console.log(`    [Crawler] Extracted: ${result.records.length} reviews`);

      if (result.records.length > 0) {
        const { inserted, skipped } = await store.upsertBatch(result.records);
        console.log(`    Stored: ${inserted} new, ${skipped} duplicates skipped`);
        totalNew += inserted;

        const newTotal = await store.getCount(seed.id, 'GOOGLE_MAPS_REVIEWS');
        console.log(`    Total in DB: ${newTotal}`);
        results.push({ name: seed.name, city: seed.city, existing: existingCount, added: inserted, total: newTotal });
      } else {
        console.log(`    No reviews extracted.`);
        results.push({ name: seed.name, city: seed.city, existing: existingCount, added: 0, total: existingCount });
      }
    } catch (err) {
      console.error(`    ERROR: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ name: seed.name, city: seed.city, existing: existingCount, added: 0, total: existingCount });
    }

    // Delay between hospitals
    if (i < HOSPITAL_SEEDS.length - 1) {
      console.log(`    Waiting ${DELAY_BETWEEN_HOSPITALS_MS / 1000}s before next...`);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS_MS));
    }
  }

  await store.disconnect();

  // Summary
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`SUMMARY — ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`${'Hospital'.padEnd(40)} ${'City'.padEnd(12)} ${'New'.padEnd(6)} Total`);
  console.log(`${'-'.repeat(60)}`);
  for (const r of results) {
    console.log(`${r.name.slice(0, 38).padEnd(40)} ${r.city.padEnd(12)} ${String(r.added).padEnd(6)} ${r.total}`);
  }
  console.log(`${'-'.repeat(60)}`);
  console.log(`Total new reviews this run: ${totalNew}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
