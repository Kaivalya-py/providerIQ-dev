// ProviderIQ — tRPC Router & Core Routes
// Powered by Inquantic.Ai

import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  OrchestratorAgent,
  SentimentAgent,
  BillingAgent,
  type SentimentAgentInput,
  type BillingAgentInput,
} from '@provideriq/agents';
import { LiveScraperConnector } from '@provideriq/connectors';
import {
  ApifyGoogleMapsReviewsConnector,
  buildAcquisitionConfig,
  classifyEvidence,
  dedupeRawEvidence,
  mapClassifiedEvidenceToSignals,
  runRawQualityGate,
} from '@provideriq/acquisition';
import { ScoringEngine } from '@provideriq/scoring';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Secure procedure checking active API keys
const apiKeySecuredProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.apiKey) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a valid ProviderIQ API key.',
    });
  }

  const keyRecord = await ctx.db.apiKey.findUnique({
    where: { key: ctx.apiKey },
  });

  if (!keyRecord || !keyRecord.isActive) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid or inactive ProviderIQ API key.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      keyRecord,
    },
  });
});

// Rank reviews by how strongly they "resonate" — longer, rating-extreme, more
// recent reviews carry more representative signal. Returns up to `limit` real
// patient comments for display in the live agent terminal.
type ResonanceRow = { text: string | null; rating: number | null; reviewDate: Date | null; source: string };
function pickResonatingComments(reviews: ResonanceRow[], limit = 10, bias?: (text: string) => number) {
  return reviews
    .filter((r) => (r.text ?? '').trim().length > 0)
    .map((r) => {
      const text = r.text ?? '';
      const len = Math.min(text.length, 400) / 400; // 0..1
      const extremity = r.rating != null ? Math.abs(r.rating - 3) / 2 : 0.4; // 0..1
      const recency = r.reviewDate ? 1 : 0.5;
      const extra = bias ? bias(text) : 0;
      return { r, resonance: len * 0.4 + extremity * 0.4 + recency * 0.2 + extra };
    })
    .sort((a, b) => b.resonance - a.resonance)
    .slice(0, limit)
    .map(({ r }) => ({
      text: (r.text ?? '').slice(0, 400),
      rating: r.rating,
      source: r.source,
      publishedAt: r.reviewDate,
      sentiment:
        r.rating == null ? 'neutral' : r.rating >= 4 ? 'positive' : r.rating <= 2 ? 'negative' : 'neutral',
    }));
}

/**
 * Keep a live-agent headline metric in sync with the dashboard's objective
 * review data. The LLM reads a text-only, recency-skewed sample and can drift
 * far from the facility's true rating distribution, so we blend its qualitative
 * read 50/50 with the objective anchor and clamp it to a ±band window. This
 * guarantees the terminal numbers never land "drastically different" from the
 * Provider Intelligence page while still letting the model nuance the result.
 */
function calibrateToAnchor(
  llmValue: number | null | undefined,
  anchor: number | null | undefined,
  band = 15
): number | null {
  const a = typeof anchor === 'number' && Number.isFinite(anchor) ? anchor : null;
  const v = typeof llmValue === 'number' && Number.isFinite(llmValue) ? llmValue : null;
  if (a == null) return v == null ? null : Math.round(v);
  if (v == null) return Math.round(a);
  const blended = 0.5 * v + 0.5 * a;
  const clamped = Math.max(a - band, Math.min(a + band, blended));
  return Math.round(Math.max(0, Math.min(100, clamped)));
}

export const appRouter = router({
  // Factual search procedure
  searchFacilities: publicProcedure
    .input(
      z.object({
        query: z.string().optional(),
        state: z.string().optional(),
        city: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const whereClause: any = {};

      if (input.state) whereClause.state = input.state;
      if (input.city) whereClause.city = input.city;
      if (input.query) {
        // SQLite doesn't support mode:'insensitive', so we use OR across fields
        const q = input.query;
        whereClause.OR = [
          { name: { contains: q } },
          { city: { contains: q } },
          { state: { contains: q } },
          { specialties: { contains: q } },
          { nameAliases: { contains: q } },
        ];
      }

      const facilities = await ctx.db.facility.findMany({
        where: {
          ...whereClause,
          reviews: { some: {} },
        },
        orderBy: { piiScore: 'desc' },
        take: 100,
        include: {
          _count: { select: { reviews: true } },
        },
      });

      // Only return facilities with meaningful review data (>1 = real scraped data)
      const withReviews = facilities
        .filter(f => f._count.reviews > 1)
        .map(({ _count, ...rest }) => ({ ...rest, reviewCount: _count.reviews }));

      return { facilities: withReviews };
    }),

  // Detailed profile retrieval
  getFacilityProfile: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const facility = await ctx.db.facility.findUnique({
        where: { id: input.id },
        include: {
          scoreHistory: { orderBy: { recordedAt: 'desc' }, take: 10 },
          signals: { orderBy: { capturedAt: 'desc' }, take: 20 },
          reviews: { orderBy: { reviewDate: 'desc' }, take: 50 },
          newsItems: { orderBy: { publishedAt: 'desc' }, take: 5 },
          _count: { select: { reviews: true } },
        },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Facility with ID ${input.id} was not found.`,
        });
      }

      // Compute real positivity index from ALL reviews (not just the 50 returned)
      const reviewStats = await ctx.db.review.aggregate({
        where: { facilityId: input.id },
        _avg: { sentimentScore: true, rating: true },
        _count: { _all: true, rating: true },
      });
      const positiveCount = await ctx.db.review.count({
        where: { facilityId: input.id, rating: { gte: 4 } },
      });
      const totalRated = reviewStats._count.rating ?? 0;
      const positivityIndex = totalRated > 0 ? Math.round((positiveCount / totalRated) * 100) : null;
      const avgRating = reviewStats._avg.rating ?? null;

      return { facility: { ...facility, reviewCount: facility._count.reviews, positivityIndex, avgRating } };
    }),

  // Timeline heatmap: dimension scores per month for a single hospital
  getHospitalTimeline: publicProcedure
    .input(z.object({ id: z.string(), months: z.number().default(12) }))
    .query(async ({ input, ctx }) => {
      const reviews = await ctx.db.review.findMany({
        where: {
          facilityId: input.id,
          reviewDate: { not: null },
          rating: { not: null },
        },
        select: { rating: true, themes: true, sentimentScore: true, reviewDate: true },
        orderBy: { reviewDate: 'desc' },
      });

      // Dimension → theme keyword mapping
      const DIM_MAP: Record<string, string[]> = {
        patient: ['staff', 'cleanliness', 'wait_time'],
        clinical: ['clinical', 'emergency'],
        billing: ['billing'],
        trust: [],
        operational: ['emergency', 'wait_time'],
      };

      // Build last N months buckets (YYYY-MM)
      const now = new Date();
      const buckets: string[] = [];
      for (let i = input.months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }

      // Group reviews by month
      const monthly: Record<string, typeof reviews> = {};
      for (const b of buckets) monthly[b] = [];
      for (const r of reviews) {
        if (!r.reviewDate) continue;
        const d = new Date(r.reviewDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthly[key]) monthly[key].push(r);
      }

      // Per dimension × month compute avg rating
      const timeline = Object.entries(DIM_MAP).map(([dim, keywords]) => ({
        dimension: dim,
        months: buckets.map(month => {
          const monthReviews = monthly[month] ?? [];
          let relevant = monthReviews;
          // Filter by themes when keywords specified; trust uses all (overall sentiment)
          if (keywords.length > 0) {
            relevant = monthReviews.filter(r =>
              r.themes && keywords.some(k => r.themes!.includes(k))
            );
          }
          if (relevant.length === 0) {
            return { month, score: null as number | null, count: 0 };
          }
          // Average rating (0-5 scale)
          const avg = relevant.reduce((s, r) => s + (r.rating ?? 0), 0) / relevant.length;
          return { month, score: Math.round(avg * 100) / 100, count: relevant.length };
        }),
      }));

      // Positivity index: % of reviews >= 4 stars (0-100 scale)
      const positiveCount = reviews.filter(r => (r.rating ?? 0) >= 4).length;
      const positivityIndex = reviews.length > 0
        ? Math.round((positiveCount / reviews.length) * 1000) / 10
        : 0;

      return { timeline, totalReviews: reviews.length, positivityIndex };
    }),

  // Secure intelligence calculation trigger
  triggerResearch: apiKeySecuredProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const facility = await ctx.db.facility.findUnique({
        where: { id: input.facilityId },
      });

      if (!facility) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Specified facility for research run does not exist.',
        });
      }

      const runId = `run_${Date.now()}`;
      const orchestrator = new OrchestratorAgent();

      // Trigger research in-memory (async runner fallback for local dev instead of full BullMQ/Redis setup)
      orchestrator
        .execute({
          facilityId: facility.id,
          facilityName: facility.name,
          city: facility.city,
          state: facility.state,
          runId,
        })
        .catch((err) => console.error(`[tRPC Trigger async error] ${String(err)}`));

      return {
        runId,
        status: 'RUNNING',
        estimatedDurationMs: 45000,
      };
    }),

  // Real-time raw data crawler for the provenance dashboard
  liveCrawl: publicProcedure
    .input(z.object({ facilityName: z.string(), city: z.string(), state: z.string() }))
    .mutation(async ({ input }) => {
      const scraper = new LiveScraperConnector();
      const result = await scraper.fetch(input.facilityName, input.city, input.state);
      return { result };
    }),

  // Fetch all raw reviews for raw JSON tab
  getAllReviews: publicProcedure
    .query(async ({ ctx }) => {
      const reviews = await ctx.db.review.findMany({
        orderBy: { crawledAt: 'desc' },
        take: 1000,
        include: { facility: { select: { name: true, city: true } } }
      });
      return { reviews };
    }),

  // List hospitals with enough review data to analyse (agent terminal selector)
  listAnalyzableHospitals: publicProcedure.query(async ({ ctx }) => {
    const facilities = await ctx.db.facility.findMany({
      where: { reviews: { some: {} } },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        _count: { select: { reviews: true } },
      },
      take: 300,
    });
    const hospitals = facilities
      .map((f) => ({ id: f.id, name: f.name, city: f.city, state: f.state, reviewCount: f._count.reviews }))
      .filter((f) => f.reviewCount > 1)
      .sort((a, b) => b.reviewCount - a.reviewCount);
    return { hospitals };
  }),

  // Run the Sentiment Agent live against a hospital's real reviews
  runSentimentAnalysis: publicProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const facility = await ctx.db.facility.findUnique({ where: { id: input.facilityId } });
      if (!facility) throw new TRPCError({ code: 'NOT_FOUND', message: 'Facility not found.' });

      const reviewRows = await ctx.db.review.findMany({
        where: { facilityId: input.facilityId, text: { not: null } },
        orderBy: { reviewDate: 'desc' },
        take: 150,
        select: { text: true, rating: true, reviewDate: true, source: true },
      });
      if (reviewRows.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No reviews available for this hospital.' });
      }

      // Objective anchors over ALL reviews — the same basis the Provider
      // Intelligence dashboard scores against — so the live read stays in sync.
      const ratingStats = await ctx.db.review.aggregate({
        where: { facilityId: input.facilityId },
        _avg: { rating: true },
        _count: { rating: true },
      });
      const positiveAll = await ctx.db.review.count({
        where: { facilityId: input.facilityId, rating: { gte: 4 } },
      });
      const totalRated = ratingStats._count.rating ?? 0;
      const avgRating = ratingStats._avg.rating ?? null;
      const ratingBaseline = avgRating != null ? Math.round((avgRating / 5) * 100) : null;
      const objPositivity = totalRated > 0 ? Math.round((positiveAll / totalRated) * 100) : null;

      const agentInput: SentimentAgentInput = {
        facilityId: facility.id,
        facilityName: facility.name,
        city: facility.city,
        state: facility.state,
        runId: `sentiment_${Date.now()}`,
        reviews: reviewRows.map((r) => ({
          text: r.text ?? '',
          rating: r.rating ?? null,
          publishedAt: r.reviewDate ?? null,
          source: r.source,
        })),
      };

      const t0 = Date.now();
      const out = await new SentimentAgent().execute(agentInput);
      const raw = (out.rawData ?? {}) as Record<string, any>;

      return {
        agent: 'SentimentAgent',
        facilityName: facility.name,
        city: facility.city,
        state: facility.state,
        status: out.status,
        error: out.error ?? null,
        executionMs: Date.now() - t0,
        reviewsAnalysed: reviewRows.length,
        findings: {
          positivityIndex: calibrateToAnchor(raw['positivityIndex'], objPositivity),
          patientExperienceScore: calibrateToAnchor(raw['patientExperienceScore'], ratingBaseline),
          clinicalQualityScore: calibrateToAnchor(
            raw['clinicalQualityScore'],
            facility.clinicalQualityScore ?? ratingBaseline
          ),
          spamMetrics: raw['spamMetrics'] ?? null,
          aspectBreakdown: raw['aspectBreakdown'] ?? null,
        },
        // What the main Provider Intelligence page shows for this facility.
        reference: {
          piiScore: facility.piiScore ?? null,
          patientExperienceScore: facility.patientExperienceScore ?? null,
          clinicalQualityScore: facility.clinicalQualityScore ?? null,
          avgRating,
          positivityIndex: objPositivity,
          totalReviews: totalRated,
        },
        signals: out.signals.map((s) => ({
          category: s.category,
          dimension: s.dimension,
          score: Math.round((s.value ?? 0) * 100),
          confidence: s.confidence ?? null,
        })),
        topComments: pickResonatingComments(reviewRows, 10),
      };
    }),

  // Run the Billing Analyst Agent live against a hospital's real reviews
  runBillingAnalysis: publicProcedure
    .input(z.object({ facilityId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const facility = await ctx.db.facility.findUnique({ where: { id: input.facilityId } });
      if (!facility) throw new TRPCError({ code: 'NOT_FOUND', message: 'Facility not found.' });

      const reviewRows = await ctx.db.review.findMany({
        where: { facilityId: input.facilityId, text: { not: null } },
        orderBy: { reviewDate: 'desc' },
        take: 150,
        select: { text: true, rating: true, reviewDate: true, source: true },
      });
      if (reviewRows.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No reviews available for this hospital.' });
      }

      const agentInput: BillingAgentInput = {
        facilityId: facility.id,
        facilityName: facility.name,
        city: facility.city,
        state: facility.state,
        runId: `billing_${Date.now()}`,
        reviews: reviewRows.map((r) => ({
          text: r.text ?? '',
          rating: r.rating ?? null,
          publishedAt: r.reviewDate ?? null,
          source: r.source,
        })),
        facilityContext: {
          nabhGrade: facility.nabhGrade,
          tier: facility.tier,
          gicEmpanelled: facility.gicEmpanelled,
          cghsEmpanelled: facility.cghsEmpanelled,
          bedCount: facility.bedCount,
        },
      };

      const t0 = Date.now();
      const out = await new BillingAgent().execute(agentInput);
      const raw = (out.rawData ?? {}) as Record<string, any>;

      // Surface the comments that actually concern money in the terminal.
      const MONEY = /(bill|charge|cost|price|expensive|deposit|payment|insur|cashless|refund|money|fee|estimat|overcharg|package|claim)/i;
      const billingBias = (text: string) => (MONEY.test(text) ? 0.5 : 0);

      // Anchor to the dashboard's stored billing/fraud dimensions so the live
      // read stays consistent with the Provider Intelligence page.
      const transparency = calibrateToAnchor(
        raw['billingTransparencyScore'],
        facility.billingStabilityScore ?? null,
        18
      );
      const fraudRisk = calibrateToAnchor(
        raw['fraudRiskScore'],
        facility.fraudRiskScore ?? null,
        20
      );

      return {
        agent: 'BillingAgent',
        facilityName: facility.name,
        city: facility.city,
        state: facility.state,
        status: out.status,
        error: out.error ?? null,
        executionMs: Date.now() - t0,
        reviewsAnalysed: reviewRows.length,
        findings: {
          billingTransparencyScore: transparency,
          fraudRiskScore: fraudRisk,
          billingReviewCount: raw['billingReviewCount'] ?? null,
          complaintBreakdown: raw['complaintBreakdown'] ?? null,
          fraudPatterns: raw['fraudPatterns'] ?? [],
          trendDirection: raw['trendDirection'] ?? null,
          narrative: raw['narrative'] ?? null,
          topBillingMentions: raw['topBillingMentions'] ?? [],
        },
        // What the main Provider Intelligence page shows for this facility.
        reference: {
          piiScore: facility.piiScore ?? null,
          billingStabilityScore: facility.billingStabilityScore ?? null,
          fraudRiskScore: facility.fraudRiskScore ?? null,
        },
        signals: out.signals.map((s) => ({
          category: s.category,
          dimension: s.dimension,
          score: Math.round((s.value ?? 0) * 100),
          confidence: s.confidence ?? null,
        })),
        topComments: pickResonatingComments(reviewRows, 10, billingBias),
      };
    }),

  // === Acquisition MVP Pipeline ===
  // Accepts hospital name + city (+ optional Google Maps URL), runs full evidence pipeline
  runAcquisition: publicProcedure
    .input(
      z.object({
        hospitalName: z.string().min(2),
        city: z.string().min(2),
        state: z.string().optional(),
        googleMapsUrl: z.string().url().optional(),
        maxReviews: z.number().int().min(1).max(500).default(100),
      })
    )
    .mutation(async ({ input }) => {
      const runId = randomUUID();
      const facilityId = randomUUID();
      const hospitalSeedId = randomUUID();
      const pipelineStart = Date.now();

      // Step tracking helper
      type PipelineStep = { name: string; description: string; durationMs: number; inputCount: number; outputCount: number; detail: Record<string, unknown> };
      const steps: PipelineStep[] = [];
      const step = (name: string, description: string, fn: () => any) => {
        const t0 = Date.now();
        const result = fn();
        return result;
      };

      const config = buildAcquisitionConfig();
      const connector = new ApifyGoogleMapsReviewsConnector(config);

      // Step 1: Resolve & Fetch Reviews
      const t1 = Date.now();
      const apifyResult = await connector.fetchReviews({
        runId,
        hospitalSeedId,
        hospitalName: input.hospitalName,
        city: input.city,
        googleMapsUrl: input.googleMapsUrl,
        maxReviews: input.maxReviews,
      });
      steps.push({
        name: 'Fetch Reviews',
        description: input.googleMapsUrl
          ? `Direct URL fetch from Google Maps`
          : `Name-based discovery: "${input.hospitalName} ${input.city}" → Apify actor`,
        durationMs: Date.now() - t1,
        inputCount: 1,
        outputCount: apifyResult.records.length,
        detail: {
          mode: input.googleMapsUrl ? 'url' : 'search',
          query: input.googleMapsUrl ?? `${input.hospitalName} ${input.city}`,
          actorId: 'compass/google-maps-reviews-scraper',
          maxReviews: input.maxReviews,
        },
      });

      // Step 2: Deduplication
      const t2 = Date.now();
      const dedupe = dedupeRawEvidence(apifyResult.records);
      steps.push({
        name: 'Deduplication',
        description: `Content-hash dedup to remove identical/near-duplicate reviews`,
        durationMs: Date.now() - t2,
        inputCount: apifyResult.records.length,
        outputCount: dedupe.unique.length,
        detail: { duplicatesRemoved: dedupe.duplicates.length, algorithm: 'content-hash' },
      });

      // Step 3: Quality Gate
      const t3 = Date.now();
      const quality = runRawQualityGate(dedupe.unique);
      steps.push({
        name: 'Quality Gate',
        description: `Filter spam, empty, and low-confidence reviews`,
        durationMs: Date.now() - t3,
        inputCount: dedupe.unique.length,
        outputCount: quality.accepted.length,
        detail: {
          accepted: quality.accepted.length,
          rejected: quality.rejected.length,
          rejectionReasons: quality.rejected.slice(0, 5).map((r: any) => r.reason ?? 'unspecified'),
        },
      });

      if (quality.accepted.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `No evidence passed quality gate. collected=${apifyResult.records.length}, rejected=${quality.rejected.length}`,
        });
      }

      // Step 4: Classification
      const t4 = Date.now();
      const classifiedEvidence = classifyEvidence(quality.accepted);
      const aspectCounts: Record<string, number> = {};
      for (const c of classifiedEvidence) {
        for (const cl of c.classifications ?? []) {
          aspectCounts[cl.aspect] = (aspectCounts[cl.aspect] ?? 0) + 1;
        }
      }
      steps.push({
        name: 'Classification',
        description: `Aspect-based sentiment analysis on each accepted review`,
        durationMs: Date.now() - t4,
        inputCount: quality.accepted.length,
        outputCount: classifiedEvidence.length,
        detail: { aspectDistribution: aspectCounts },
      });

      // Step 5: Signal Extraction
      const t5 = Date.now();
      const evidenceById = new Map(quality.accepted.map((r) => [r.id, r]));
      const signals = mapClassifiedEvidenceToSignals({
        facilityId,
        classifiedEvidence,
        evidenceById,
      });
      steps.push({
        name: 'Signal Extraction',
        description: `Map classified evidence to scorable signals per dimension`,
        durationMs: Date.now() - t5,
        inputCount: classifiedEvidence.length,
        outputCount: signals.length,
        detail: {
          signalTypes: [...new Set(signals.map((s) => s.dimension ?? 'unknown'))],
        },
      });

      // Step 6: Scoring
      const t6 = Date.now();
      const scoringEngine = new ScoringEngine();
      const score = scoringEngine.compute({
        facilityId,
        facility: {
          id: facilityId,
          name: input.hospitalName,
          city: input.city,
          state: input.state ?? 'UNKNOWN',
          tier: 'TIER_2',
          facilityType: 'HOSPITAL',
          specialties: [],
        },
        signals,
      });
      steps.push({
        name: 'PII Scoring',
        description: `Compute Provider Intelligence Index from weighted signal aggregation`,
        durationMs: Date.now() - t6,
        inputCount: signals.length,
        outputCount: 1,
        detail: {
          piiScore: score.piiScore,
          confidence: score.confidence,
          dimensionCount: Object.keys(score.dimensions).length,
        },
      });

      // Sample reviews for UI display
      const sampleReviews = quality.accepted.slice(0, 10).map((r) => ({
        text: r.text?.slice(0, 300) ?? '',
        rating: r.rating,
        publishedAt: r.publishedAt,
        sentiment: classifiedEvidence.find((c) => c.id === r.id)?.classifications?.[0]?.sentiment ?? 'neutral',
        aspects: classifiedEvidence.find((c) => c.id === r.id)?.classifications?.map((c) => c.aspect) ?? [],
      }));

      return {
        runId,
        hospitalName: input.hospitalName,
        city: input.city,
        collected: apifyResult.records.length,
        accepted: quality.accepted.length,
        rejected: quality.rejected.length,
        duplicatesRemoved: dedupe.duplicates.length,
        signalCount: signals.length,
        score: score.piiScore,
        dimensions: score.dimensions,
        positiveFactors: score.positiveFactors,
        negativeFactors: score.negativeFactors,
        confidence: score.confidence,
        narrative: score.narrative,
        sampleReviews,
        // Pipeline provenance — every layer the data flows through
        provenance: {
          totalDurationMs: Date.now() - pipelineStart,
          steps,
        },
      };
    }),
});
export type AppRouter = typeof appRouter;
