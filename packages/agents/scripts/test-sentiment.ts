// ProviderIQ — Sentiment Agent smoke test
// Loads .env, picks a real facility with reviews, runs the agent, prints results.
// Usage:  pnpm -F @provideriq/agents test:sentiment
//         pnpm -F @provideriq/agents test:sentiment "Apollo"  (case-insensitive name filter)

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Locate the repo root and load .env BEFORE importing modules that read process.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');
loadEnv({ path: resolve(repoRoot, '.env') });

import { prisma } from '@provideriq/database';
import { SentimentAgent, type SentimentAgentInput } from '../src/index.js';

async function main(): Promise<void> {
  const nameFilter = process.argv[2];

  console.log('— ProviderIQ Sentiment Agent test —');
  console.log(`Model: ${process.env['GEMINI_MODEL'] ?? 'gemini-3.5-flash'}`);
  console.log(`Key present: ${process.env['GEMINI_API_KEY'] ? 'yes' : 'NO'}`);
  console.log('');

  // Pick a facility with the most reviews (optionally filtered by name)
  const where = nameFilter
    ? { name: { contains: nameFilter, mode: 'insensitive' as const }, reviews: { some: {} } }
    : { reviews: { some: {} } };

  const facilities = await prisma.facility.findMany({
    where,
    include: { _count: { select: { reviews: true } } },
    take: 25,
  });

  const sorted = facilities
    .filter((f) => f._count.reviews >= 5)
    .sort((a, b) => b._count.reviews - a._count.reviews);

  const facility = sorted[0];
  if (!facility) {
    console.error(`No facility found${nameFilter ? ` matching "${nameFilter}"` : ''} with >= 5 reviews.`);
    process.exit(1);
  }

  console.log(`Facility: ${facility.name} (${facility.city ?? '—'})  •  ${facility._count.reviews} reviews`);

  const reviews = await prisma.review.findMany({
    where: { facilityId: facility.id, text: { not: null } },
    orderBy: { reviewDate: 'desc' },
    take: 150,
    select: { text: true, rating: true, reviewDate: true, source: true },
  });

  console.log(`Pulled ${reviews.length} reviews with text.`);
  console.log('');

  const input: SentimentAgentInput = {
    facilityId: facility.id,
    facilityName: facility.name,
    city: facility.city ?? '',
    state: facility.state ?? '',
    runId: `smoke-${Date.now()}`,
    reviews: reviews.map((r) => ({
      text: r.text ?? '',
      rating: r.rating ?? null,
      publishedAt: r.reviewDate ?? null,
      source: r.source,
    })),
  };

  const agent = new SentimentAgent();
  console.log('Calling Gemini…');
  const t0 = Date.now();
  const out = await agent.execute(input);
  const elapsed = Date.now() - t0;

  console.log('');
  console.log(`Status: ${out.status}  •  Elapsed: ${elapsed}ms  •  Reported: ${out.executionMs}ms`);
  if (out.error) {
    console.error('Error:', out.error);
  }

  if (out.signals.length) {
    console.log('');
    console.log('Signals:');
    for (const s of out.signals) {
      const score100 = Math.round((s.value ?? 0) * 100);
      console.log(
        `  ${s.category.padEnd(8)}  ${String(s.dimension).padEnd(22)}  score=${score100.toString().padStart(3)}/100  conf=${(s.confidence ?? 0).toFixed(2)}`
      );
    }
  }

  if (out.rawData) {
    const raw = out.rawData as {
      positivityIndex?: number;
      patientExperienceScore?: number;
      clinicalQualityScore?: number;
      spamMetrics?: { manipulationRisk?: string; spamFiltered?: number; afterGating?: number; burstDetected?: boolean };
      topPositiveReviews?: string[];
      topNegativeReviews?: string[];
    };
    console.log('');
    console.log('Aggregates:');
    console.log(`  Positivity Index:        ${raw.positivityIndex}`);
    console.log(`  Patient Experience:      ${raw.patientExperienceScore}`);
    console.log(`  Clinical Quality:        ${raw.clinicalQualityScore}`);
    if (raw.spamMetrics) {
      console.log(`  Spam filtered:           ${raw.spamMetrics.spamFiltered} (kept ${raw.spamMetrics.afterGating})`);
      console.log(`  Manipulation risk:       ${raw.spamMetrics.manipulationRisk}  •  burst=${raw.spamMetrics.burstDetected}`);
    }
    if (raw.topPositiveReviews?.length) {
      console.log('');
      console.log('Top positive snippets:');
      raw.topPositiveReviews.slice(0, 3).forEach((q) => console.log(`  + ${q}`));
    }
    if (raw.topNegativeReviews?.length) {
      console.log('');
      console.log('Top negative snippets:');
      raw.topNegativeReviews.slice(0, 3).forEach((q) => console.log(`  - ${q}`));
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Fatal:', e);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
