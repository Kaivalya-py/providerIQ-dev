// ProviderIQ — Full pipeline smoke test
// Loads .env, picks a real facility with reviews, runs the OrchestratorAgent
// end-to-end (Registry + Sentiment + Billing + Web Research + Supervisor + Scoring).
// Usage:  pnpm -F @provideriq/agents test:pipeline
//         pnpm -F @provideriq/agents test:pipeline "Manipal"  (name filter)

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
import { OrchestratorAgent } from '../src/index.js';
import type { AgentInput } from '@provideriq/shared';

async function main(): Promise<void> {
  const nameFilter = process.argv[2];

  console.log('— ProviderIQ Full Pipeline test —');
  console.log(`Model: ${process.env['GEMINI_MODEL'] ?? 'gemini-3.5-flash'}`);
  console.log(`Key present: ${process.env['GEMINI_API_KEY'] ? 'yes' : 'NO'}`);
  console.log('');

  const where = nameFilter
    ? { name: { contains: nameFilter }, reviews: { some: {} } }
    : { reviews: { some: {} } };

  const facilities = await prisma.facility.findMany({
    where,
    include: { _count: { select: { reviews: true } } },
    take: 25,
  });

  const facility = facilities
    .filter((f) => f._count.reviews >= 5)
    .sort((a, b) => b._count.reviews - a._count.reviews)[0];

  if (!facility) {
    console.error(`No facility found${nameFilter ? ` matching "${nameFilter}"` : ''} with >= 5 reviews.`);
    process.exit(1);
  }

  console.log(`Facility: ${facility.name} (${facility.city ?? '—'})  •  ${facility._count.reviews} reviews`);
  console.log('');

  const input: AgentInput = {
    facilityId: facility.id,
    facilityName: facility.name,
    city: facility.city ?? '',
    state: facility.state ?? '',
    abdmFacilityId: facility.abdmFacilityId ?? undefined,
    nabhAccreditationNo: facility.nabhAccreditationNo ?? undefined,
    runId: `pipeline-${Date.now()}`,
  };

  const orchestrator = new OrchestratorAgent();
  console.log('Running pipeline…');
  const t0 = Date.now();
  const out = await orchestrator.execute(input);
  const elapsed = Date.now() - t0;

  console.log('');
  console.log(`Status: ${out.status}  •  Elapsed: ${elapsed}ms`);
  if (out.error) console.error('Error:', out.error);

  const raw = (out.rawData ?? {}) as any;

  if (raw.agents) {
    console.log('');
    console.log('Per-agent:');
    for (const [name, a] of Object.entries(raw.agents) as [string, any][]) {
      console.log(`  ${name.padEnd(13)}  status=${String(a.status).padEnd(8)}  signals=${a.signals ?? '—'}`);
    }
    const sup = raw.agents.supervisor?.rawData;
    if (sup) {
      console.log('');
      console.log('Supervisor verdict:');
      console.log(`  Verdict:             ${sup.verdict}`);
      console.log(`  Agents succeeded:    ${sup.agentsSucceeded}`);
      console.log(`  Fraud corroboration: ${sup.fraudCorroboration}  (${(sup.fraudReasons ?? []).join('; ') || 'none'})`);
      if ((sup.contradictions ?? []).length) {
        console.log('  Contradictions:');
        for (const c of sup.contradictions) console.log(`    - [${c.severity}] ${c.detail}`);
      }
      if ((sup.corroborations ?? []).length) {
        console.log('  Corroborations:');
        for (const c of sup.corroborations) console.log(`    + ${c}`);
      }
    }
  }

  const sr = raw.scoringResult;
  if (sr) {
    console.log('');
    console.log('Scoring:');
    console.log(`  PII Score:           ${Math.round(sr.piiScore)}/100`);
    const d = sr.dimensions ?? {};
    const row = (label: string, dim: any) =>
      console.log(`  ${label.padEnd(20)} ${Math.round(dim?.score ?? 0).toString().padStart(3)}/100  conf=${(dim?.confidence ?? 0).toFixed?.(2) ?? '—'}`);
    row('Trust', d.trust);
    row('Operational', d.operational);
    row('Billing Stability', d.billingStability);
    row('Clinical Quality', d.clinicalQuality);
    row('Patient Experience', d.patientExperience);
    row('Fraud Risk', d.fraudRisk);
  }

  console.log('');
  console.log(`Signals persisted: ${raw.signalsPersisted ?? '—'}  •  Reviews analysed: ${raw.reviewsAnalysed ?? '—'}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
