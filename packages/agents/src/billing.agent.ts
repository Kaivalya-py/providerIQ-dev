// ProviderIQ — Billing Agent
// Analyses billing-related patient reviews via Gemini and emits BILLING + FRAUD signals.
// Powered by Inquantic.Ai

import type { AgentInput, AgentOutput, SignalInput } from '@provideriq/shared';
import { BaseAgent } from './base.agent.js';
import { generateJSON } from './llm.js';

export interface BillingReview {
  text: string;
  rating: number | null;
  publishedAt?: string | Date | null;
  source: string;
}

export interface BillingFacilityContext {
  nabhGrade?: string | null;
  tier?: string | null;
  gicEmpanelled?: boolean | null;
  cghsEmpanelled?: boolean | null;
  bedCount?: number | null;
}

export interface BillingAgentInput extends AgentInput {
  reviews: BillingReview[];
  facilityContext?: BillingFacilityContext;
}

interface BillingFraudPattern {
  pattern: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reviewCount: number;
  confidence: number;
  detail: string;
}

interface BillingLLMOutput {
  totalReviews: number;
  billingReviewCount: number;
  complaintBreakdown: Record<string, number>;
  fraudPatterns: BillingFraudPattern[];
  billingTransparencyScore: number; // 0-100, higher = more transparent
  fraudRiskScore: number; // 0-100, higher = more fraud risk
  trendDirection: 'improving' | 'stable' | 'worsening';
  topBillingMentions: string[];
  narrative: string;
}

const SYSTEM_INSTRUCTION = `You are the Billing Agent for ProviderIQ — a financial-conduct analyst for healthcare facilities.

Your job: read patient reviews, isolate those that concern money (cost, charges, billing, deposits, insurance/cashless), and produce structured BILLING and FRAUD signals.

Operating principles:
- Judge meaning from full context, not keyword matching. A complaint qualifies for a pattern whenever its substance fits, in any wording or language.
- Distinguish a fair, transparent billing experience from a genuine grievance. Praise for clear or reasonable billing is a positive signal.
- Weight by severity and credibility: a few specific, credible accounts of serious financial misconduct (charging for undelivered care, withholding a patient over payment, denying contracted cashless) carry more weight than many vague gripes about price.
- A single account is anecdotal; multiple independent accounts of the same pattern indicate a systematic issue. Scale confidence with the number and independence of corroborating reviews.
- Where a tariff or accreditation context is supplied, judge amounts relative to that context and the location's cost level — never against memorised figures.
- Never fabricate. If the reviews contain little or no billing information, say so, return a neutral transparency score, a low fraud-risk score, and lower confidence.
- Return ONLY valid JSON. No prose, no markdown code fences, no commentary.`;

function buildPrompt(input: BillingAgentInput): string {
  const MAX_REVIEWS = 120;
  const reviewLines = input.reviews
    .slice(0, MAX_REVIEWS)
    .map((r, i) => {
      const date = r.publishedAt
        ? typeof r.publishedAt === 'string'
          ? r.publishedAt
          : r.publishedAt.toISOString().slice(0, 10)
        : 'undated';
      const text = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 600);
      return `[#${i + 1}] (${r.rating ?? '?'}\u2605, ${r.source}, ${date}) ${text}`;
    })
    .join('\n');

  const ctx = input.facilityContext;
  const ctxLine = ctx
    ? `Facility context: NABH grade=${ctx.nabhGrade ?? 'n/a'}, tier=${ctx.tier ?? 'n/a'}, GIC empanelled=${ctx.gicEmpanelled ?? 'n/a'}, CGHS empanelled=${ctx.cghsEmpanelled ?? 'n/a'}, beds=${ctx.bedCount ?? 'n/a'}`
    : 'Facility context: none supplied';

  return `Facility: ${input.facilityName}
City: ${input.city}, ${input.state}
${ctxLine}
Reviews supplied: ${input.reviews.length} (analysing first ${Math.min(input.reviews.length, MAX_REVIEWS)})

REVIEWS
-------
${reviewLines}

TASK
----
1. Identify which reviews actually concern money / billing / insurance.
2. For each billing-related review, classify the grievance (or praise) by substance into these types and count them:
   tariff_deviation, cashless_denial, phantom_billing, deposit_extortion, hidden_charges, unnecessary_procedures, package_violation, insurance_harassment, positive_billing.
3. Identify systematic fraud patterns (only where multiple independent reviews corroborate), each with a severity, the number of supporting reviews, a confidence in [0,1], and a one-line detail.
4. Compute billingTransparencyScore (0-100): higher = clearer, fairer billing. Start neutral when there is little billing evidence.
5. Compute fraudRiskScore (0-100): higher = stronger, corroborated financial-misconduct signal. Start low when there is little evidence.
6. Determine trendDirection over time: improving | stable | worsening.
7. Pick up to 3 representative billing-related snippets (quote <= 25 words each, no personal identifiers).

Return JSON exactly in this shape (no extra keys, no fences):
{
  "totalReviews": <int>,
  "billingReviewCount": <int>,
  "complaintBreakdown": {
    "tariff_deviation": <int>, "cashless_denial": <int>, "phantom_billing": <int>,
    "deposit_extortion": <int>, "hidden_charges": <int>, "unnecessary_procedures": <int>,
    "package_violation": <int>, "insurance_harassment": <int>, "positive_billing": <int>
  },
  "fraudPatterns": [
    { "pattern": "<string>", "severity": "low"|"medium"|"high"|"critical", "reviewCount": <int>, "confidence": <0-1>, "detail": "<string>" }
  ],
  "billingTransparencyScore": <0-100>,
  "fraudRiskScore": <0-100>,
  "trendDirection": "improving"|"stable"|"worsening",
  "topBillingMentions": ["...", "...", "..."],
  "narrative": "<2-3 sentence summary>"
}`;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

function buildSignals(out: BillingLLMOutput): SignalInput[] {
  const transparency = clamp01((out.billingTransparencyScore ?? 60) / 100);
  const fraud = clamp01((out.fraudRiskScore ?? 10) / 100);

  // Confidence rises with the amount of billing evidence available.
  const evidence = out.billingReviewCount ?? 0;
  const evidenceConf = evidence >= 20 ? 0.85 : evidence >= 8 ? 0.78 : evidence >= 3 ? 0.68 : 0.55;

  const signals: SignalInput[] = [
    {
      category: 'BILLING',
      dimension: 'billing_transparency',
      source: 'REVIEWS_NLP',
      value: transparency,
      sentiment: transparency * 2 - 1,
      weight: 1,
      confidence: evidenceConf,
    },
    {
      category: 'FRAUD',
      dimension: 'billing_fraud_risk',
      source: 'REVIEWS_NLP',
      value: fraud,
      weight: 1,
      confidence: evidenceConf,
    },
  ];

  // Surface each corroborated high/critical fraud pattern as its own FRAUD signal.
  for (const p of out.fraudPatterns ?? []) {
    if ((p.severity === 'high' || p.severity === 'critical') && (p.reviewCount ?? 0) >= 2) {
      signals.push({
        category: 'FRAUD',
        dimension: `pattern_${p.pattern}`.slice(0, 60),
        source: 'REVIEWS_NLP',
        value: p.severity === 'critical' ? 0.9 : 0.7,
        valueText: p.detail?.slice(0, 200),
        weight: 1,
        confidence: clamp01(p.confidence ?? 0.6),
      });
    }
  }

  return signals;
}

export class BillingAgent extends BaseAgent {
  name = 'BillingAgent';
  description = 'NLP analysis of billing-related reviews → BILLING + FRAUD signals';

  async execute(input: AgentInput): Promise<AgentOutput> {
    const t0 = Date.now();
    const billingInput = input as BillingAgentInput;

    if (!billingInput.reviews || billingInput.reviews.length === 0) {
      // No reviews → emit neutral baselines so scoring still has billing coverage.
      const neutral: SignalInput[] = [
        { category: 'BILLING', dimension: 'billing_transparency', source: 'REVIEWS_NLP', value: 0.6, weight: 1, confidence: 0.4 },
        { category: 'FRAUD', dimension: 'billing_fraud_risk', source: 'REVIEWS_NLP', value: 0.1, weight: 1, confidence: 0.4 },
      ];
      return this.createOutput(input, 'partial', neutral, Date.now() - t0, 'No reviews provided to BillingAgent', {
        billingTransparencyScore: 60,
        fraudRiskScore: 10,
        billingReviewCount: 0,
      });
    }

    try {
      const prompt = buildPrompt(billingInput);
      const llmOut = await generateJSON<BillingLLMOutput>(prompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        maxOutputTokens: 8192,
      });

      const signals = buildSignals(llmOut);

      return this.createOutput(input, 'success', signals, Date.now() - t0, undefined, {
        billingTransparencyScore: llmOut.billingTransparencyScore,
        fraudRiskScore: llmOut.fraudRiskScore,
        billingReviewCount: llmOut.billingReviewCount,
        complaintBreakdown: llmOut.complaintBreakdown,
        fraudPatterns: llmOut.fraudPatterns,
        trendDirection: llmOut.trendDirection,
        topBillingMentions: llmOut.topBillingMentions,
        narrative: llmOut.narrative,
      });
    } catch (e) {
      return this.createOutput(input, 'failed', [], Date.now() - t0, (e as Error).message);
    }
  }
}
