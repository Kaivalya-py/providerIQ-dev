// ProviderIQ — Sentiment Agent
// Analyses patient reviews via Gemini and emits PATIENT + CLINICAL signals.
// Powered by Inquantic.Ai

import type { AgentInput, AgentOutput, SignalInput, SignalCategory } from '@provideriq/shared';
import { BaseAgent } from './base.agent.js';
import { generateJSON } from './llm.js';

export interface SentimentReview {
  text: string;
  rating: number | null;
  publishedAt?: string | Date | null;
  source: string;
  reviewerName?: string;
}

export interface SentimentAgentInput extends AgentInput {
  reviews: SentimentReview[];
}

interface AspectStat {
  positive: number;
  negative: number;
  neutral: number;
  sentimentScore: number;
}

interface SentimentLLMOutput {
  aspectBreakdown: Record<string, AspectStat>;
  spamMetrics: {
    totalReviews: number;
    afterGating: number;
    spamFiltered: number;
    duplicatesRemoved: number;
    burstDetected: boolean;
    manipulationRisk: 'low' | 'medium' | 'high';
  };
  positivityIndex: number;
  patientExperienceScore: number;
  clinicalQualityScore: number;
  topPositiveReviews: string[];
  topNegativeReviews: string[];
}

const SYSTEM_INSTRUCTION = `You are the Sentiment Agent for ProviderIQ — a patient-review analyst for healthcare facilities.

Your job: read patient reviews and produce structured signals across PATIENT and CLINICAL dimensions.

Operating principles:
- Judge meaning from full context, not keyword matching. Infer intent even when wording is indirect, idiomatic, sarcastic, or ironic.
- Reviews may be written in any language or mix of languages. Interpret each on its own terms; lower confidence only when meaning is genuinely ambiguous, not because of language.
- Weight by severity and credibility: a small number of specific, credible accounts of serious harm carry more clinical weight than a large volume of generic praise. Apply the same logic in reverse for credible exceptional care.
- Weight by recency: more recent experiences describe the facility's current state better than older ones.
- Weight by specificity: detailed, verifiable accounts are more reliable than vague or templated ones.
- Identify low-quality or manipulated input on its merits — content that carries no real information, near-duplicate text, or unnatural clustering of similar ratings in a short window — rather than matching fixed phrases.
- Never fabricate. If a dimension has no supporting evidence in the reviews, return a neutral sentimentScore (0.5) and lower the confidence instead of inventing a verdict.
- Return ONLY valid JSON. No prose, no markdown code fences, no commentary.`;

function buildPrompt(input: SentimentAgentInput): string {
  // Cap to a sane window so we stay inside the model's context for free-tier requests.
  const MAX_REVIEWS = 150;
  const reviewLines = input.reviews
    .slice(0, MAX_REVIEWS)
    .map((r, i) => {
      const date = r.publishedAt
        ? (typeof r.publishedAt === 'string' ? r.publishedAt : r.publishedAt.toISOString().slice(0, 10))
        : 'undated';
      const text = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 600);
      return `[#${i + 1}] (${r.rating ?? '?'}★, ${r.source}, ${date}) ${text}`;
    })
    .join('\n');

  return `Hospital: ${input.facilityName}
City: ${input.city}, ${input.state}
Reviews supplied: ${input.reviews.length} (analysing first ${Math.min(input.reviews.length, MAX_REVIEWS)})

REVIEWS
-------
${reviewLines}

TASK
----
1. Classify each review across these aspects (a review can hit multiple): staff_behavior, clinical_care, wait_time, billing_issues, facility, communication, post_op, safety.
2. Count positive / negative / neutral mentions per aspect and compute a sentimentScore in [0, 1] where 1 = best.
3. Compute spam metrics: totalReviews, afterGating (after removing spam/dupes), spamFiltered, duplicatesRemoved, burstDetected, manipulationRisk.
4. Compute positivityIndex (0-100) = % of reviews with rating ≥ 4 (treat unrated reviews by their sentiment).
5. Compute patientExperienceScore (0-100): weighted mean of staff_behavior (0.30) + wait_time (0.20) + facility (0.25) + communication (0.25). Apply recency decay.
6. Compute clinicalQualityScore (0-100): weighted mean of clinical_care (0.45) + post_op (0.30) + safety (0.25). Safety incidents have 3× severity.
7. Pick exactly 3 representative positive and 3 negative review snippets (quote ≤ 25 words each, no PII).

Return JSON exactly matching this shape (no extra keys, no fences):
{
  "aspectBreakdown": {
    "staff_behavior": {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>},
    "clinical_care":  {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>},
    "wait_time":      {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>},
    "billing_issues": {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>},
    "facility":       {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>},
    "communication":  {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>},
    "post_op":        {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>},
    "safety":         {"positive": <int>, "negative": <int>, "neutral": <int>, "sentimentScore": <0-1>}
  },
  "spamMetrics": {
    "totalReviews": <int>, "afterGating": <int>, "spamFiltered": <int>,
    "duplicatesRemoved": <int>, "burstDetected": <bool>,
    "manipulationRisk": "low"|"medium"|"high"
  },
  "positivityIndex": <0-100>,
  "patientExperienceScore": <0-100>,
  "clinicalQualityScore": <0-100>,
  "topPositiveReviews": ["...", "...", "..."],
  "topNegativeReviews": ["...", "...", "..."]
}`;
}

function aspectScore(ab: Record<string, AspectStat>, key: string): number {
  const v = ab[key]?.sentimentScore;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

function buildSignals(out: SentimentLLMOutput): SignalInput[] {
  const make = (
    category: SignalCategory,
    dimension: string,
    score: number,
    confidence = 0.85
  ): SignalInput => ({
    category,
    dimension,
    source: 'REVIEWS_NLP',
    value: score,
    sentiment: score * 2 - 1, // 0..1 → -1..1
    weight: 1,
    confidence,
  });

  const ab = out.aspectBreakdown ?? {};
  return [
    make('PATIENT',  'staff_behavior',     aspectScore(ab, 'staff_behavior')),
    make('PATIENT',  'wait_time',          aspectScore(ab, 'wait_time')),
    make('PATIENT',  'facility_quality',   aspectScore(ab, 'facility')),
    make('PATIENT',  'communication',      aspectScore(ab, 'communication')),
    make('CLINICAL', 'treatment_outcomes', aspectScore(ab, 'clinical_care')),
    make('CLINICAL', 'safety_record',      aspectScore(ab, 'safety'), 0.7),
    make('CLINICAL', 'post_op_quality',    aspectScore(ab, 'post_op')),
    make('BILLING',  'billing_complaints', aspectScore(ab, 'billing_issues')),
  ];
}

export class SentimentAgent extends BaseAgent {
  name = 'SentimentAgent';
  description = 'NLP analysis of patient reviews → PATIENT, CLINICAL, BILLING signals';

  async execute(input: AgentInput): Promise<AgentOutput> {
    const t0 = Date.now();
    const sentimentInput = input as SentimentAgentInput;

    if (!sentimentInput.reviews || sentimentInput.reviews.length === 0) {
      return this.createOutput(input, 'failed', [], Date.now() - t0, 'No reviews provided to SentimentAgent');
    }

    try {
      const prompt = buildPrompt(sentimentInput);
      const llmOut = await generateJSON<SentimentLLMOutput>(prompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        maxOutputTokens: 8192,
      });

      const signals = buildSignals(llmOut);

      return this.createOutput(input, 'success', signals, Date.now() - t0, undefined, {
        aspectBreakdown: llmOut.aspectBreakdown,
        spamMetrics: llmOut.spamMetrics,
        positivityIndex: llmOut.positivityIndex,
        patientExperienceScore: llmOut.patientExperienceScore,
        clinicalQualityScore: llmOut.clinicalQualityScore,
        topPositiveReviews: llmOut.topPositiveReviews,
        topNegativeReviews: llmOut.topNegativeReviews,
      });
    } catch (e) {
      return this.createOutput(input, 'failed', [], Date.now() - t0, (e as Error).message);
    }
  }
}
