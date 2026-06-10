// ProviderIQ — Web Research Agent
// Assesses a facility's public footprint via Gemini and emits TRUST + FRAUD signals.
// Strict anti-fabrication: when it lacks confident public knowledge it returns
// neutral signals rather than inventing evidence.
// Powered by Inquantic.Ai

import type { AgentInput, AgentOutput, SignalInput } from '@provideriq/shared';
import { BaseAgent } from './base.agent.js';
import { generateJSON } from './llm.js';

interface WebEvidence {
  title: string;
  category:
    | 'LEGAL_NEGATIVE'
    | 'REGULATORY_ACTION'
    | 'NEWS_NEGATIVE'
    | 'NEWS_POSITIVE'
    | 'GOVT_EMPANELLED'
    | 'INSTABILITY';
  credibility: number; // 0-1
  recencyNote: string;
  detail: string;
}

interface WebResearchLLMOutput {
  evidence: WebEvidence[];
  summary: {
    legalCases: number;
    regulatoryActions: number;
    newsNegative: number;
    newsPositive: number;
    govtEmpanelled: number;
    instabilityFlags: number;
    overallSentiment: 'positive' | 'mixed' | 'negative' | 'no_evidence';
  };
  publicReputationScore: number; // 0-100, higher = better public standing
  legalRiskScore: number; // 0-100, higher = more legal/fraud exposure
  evidenceConfidence: number; // 0-1, how confident the model is its evidence is real & specific
  note: string;
}

const SYSTEM_INSTRUCTION = `You are the Web Research Agent for ProviderIQ — an investigator of a healthcare facility's public footprint beyond patient reviews.

You assess public-domain reputation signals: litigation and consumer/medical-negligence cases, regulatory actions (listing, delisting, suspension, warnings), credible news (negative or positive), public-scheme empanelment, and signs of institutional instability.

Operating principles:
- Investigate in a balanced way — weigh negative and positive evidence equally; never assume guilt or excellence.
- Verify identity: only attribute evidence you are confident refers to THIS specific facility in THIS city. Same-brand facilities in other locations are different entities — never cross-attribute.
- Weight findings by source credibility and recency, not by whether they are positive or negative. Older issues with no recurrence should not dominate the present picture.
- CRITICAL — never fabricate. Only report evidence you are genuinely confident corresponds to real, publicly reported events about this exact facility. If you are not confident, return an empty evidence list, "no_evidence" sentiment, a neutral reputation score, a low legal-risk score, and a low evidenceConfidence. Do NOT invent cases, awards, headlines, dates, or sources.
- Treat allegations as allegations until adjudicated; do not state them as established fact.
- Return ONLY valid JSON. No prose, no markdown code fences, no commentary.`;

function buildPrompt(input: AgentInput): string {
  return `Facility: ${input.facilityName}
City: ${input.city}, ${input.state}

TASK
----
Assess the public footprint of this exact facility based only on what you can confidently recall from public knowledge.

1. List any concrete, real, public-domain evidence items (legal cases, regulatory actions, credible news, public-scheme empanelment, instability). For each: a short title, a category, a credibility in [0,1], a recency note, and a one-line detail. If you are not confident an item is real and specific to this facility, omit it.
2. Summarise counts by category and an overall sentiment (positive | mixed | negative | no_evidence).
3. publicReputationScore (0-100): higher = stronger public standing. Use ~60 (neutral) when there is no clear evidence either way.
4. legalRiskScore (0-100): higher = more credible legal/regulatory/fraud exposure. Use ~10 when there is no evidence.
5. evidenceConfidence (0-1): how confident you are that your reported evidence is real and specific to this facility.
6. note: one sentence on the basis and limits of this assessment.

Return JSON exactly in this shape (no extra keys, no fences):
{
  "evidence": [
    { "title": "<string>", "category": "LEGAL_NEGATIVE"|"REGULATORY_ACTION"|"NEWS_NEGATIVE"|"NEWS_POSITIVE"|"GOVT_EMPANELLED"|"INSTABILITY", "credibility": <0-1>, "recencyNote": "<string>", "detail": "<string>" }
  ],
  "summary": {
    "legalCases": <int>, "regulatoryActions": <int>, "newsNegative": <int>,
    "newsPositive": <int>, "govtEmpanelled": <int>, "instabilityFlags": <int>,
    "overallSentiment": "positive"|"mixed"|"negative"|"no_evidence"
  },
  "publicReputationScore": <0-100>,
  "legalRiskScore": <0-100>,
  "evidenceConfidence": <0-1>,
  "note": "<string>"
}`;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

export class WebResearchAgent extends BaseAgent {
  name = 'WebResearchAgent';
  description = 'Assesses a facility\u2019s public footprint \u2192 TRUST + FRAUD signals';

  async execute(input: AgentInput): Promise<AgentOutput> {
    const t0 = Date.now();

    try {
      const prompt = buildPrompt(input);
      const out = await generateJSON<WebResearchLLMOutput>(prompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        maxOutputTokens: 2048,
      });

      const reputation = clamp01((out.publicReputationScore ?? 60) / 100);
      const legalRisk = clamp01((out.legalRiskScore ?? 10) / 100);
      // Confidence is gated by how sure the model is that its evidence is real.
      const evConf = clamp01(out.evidenceConfidence ?? 0.4);
      const hasEvidence = (out.evidence?.length ?? 0) > 0;

      const signals: SignalInput[] = [
        {
          category: 'TRUST',
          dimension: 'public_reputation',
          source: 'WEB',
          value: reputation,
          sentiment: reputation * 2 - 1,
          weight: 1,
          // Neutral, low-evidence assessments contribute little.
          confidence: hasEvidence ? Math.max(0.4, evConf) : 0.4,
        },
        {
          category: 'FRAUD',
          dimension: 'public_legal_risk',
          source: 'WEB',
          value: legalRisk,
          weight: 1,
          confidence: hasEvidence ? Math.max(0.4, evConf) : 0.4,
        },
      ];

      const status = hasEvidence ? 'success' : 'partial';
      return this.createOutput(input, status, signals, Date.now() - t0, undefined, {
        evidence: out.evidence ?? [],
        summary: out.summary,
        publicReputationScore: out.publicReputationScore,
        legalRiskScore: out.legalRiskScore,
        evidenceConfidence: out.evidenceConfidence,
        note: out.note,
      });
    } catch (e) {
      // Degrade gracefully to neutral rather than failing the whole pipeline.
      const neutral: SignalInput[] = [
        { category: 'TRUST', dimension: 'public_reputation', source: 'WEB', value: 0.6, weight: 1, confidence: 0.3 },
        { category: 'FRAUD', dimension: 'public_legal_risk', source: 'WEB', value: 0.1, weight: 1, confidence: 0.3 },
      ];
      return this.createOutput(input, 'partial', neutral, Date.now() - t0, (e as Error).message, {
        publicReputationScore: 60,
        legalRiskScore: 10,
        evidenceConfidence: 0,
      });
    }
  }
}
