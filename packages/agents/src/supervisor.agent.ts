// ProviderIQ — Supervisor Agent
// Runs AFTER the other agents. Cross-validates their outputs, corroborates fraud
// across independent sources, detects contradictions, and issues a verdict.
// Deterministic — no LLM call. Adds no new signals; it audits.
// Powered by Inquantic.Ai

import type { AgentInput, AgentOutput } from '@provideriq/shared';
import { BaseAgent } from './base.agent.js';

export interface SupervisorAgentInput extends AgentInput {
  agentOutputs: {
    registry?: AgentOutput;
    sentiment?: AgentOutput;
    billing?: AgentOutput;
    webResearch?: AgentOutput;
  };
}

type Verdict =
  | 'VALIDATED'
  | 'VALIDATED_WITH_NOTES'
  | 'FLAGGED'
  | 'ESCALATED'
  | 'INSUFFICIENT_DATA';

interface Contradiction {
  type: string;
  severity: 'low' | 'medium' | 'high';
  detail: string;
  agents: string[];
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export class SupervisorAgent extends BaseAgent {
  name = 'SupervisorAgent';
  description = 'Cross-validates agent outputs, corroborates fraud, issues a verdict';

  async execute(input: AgentInput): Promise<AgentOutput> {
    const t0 = Date.now();
    const { agentOutputs } = input as SupervisorAgentInput;

    if (!agentOutputs) {
      return this.createOutput(input, 'failed', [], Date.now() - t0, 'No agentOutputs provided to SupervisorAgent');
    }

    const { registry, sentiment, billing, webResearch } = agentOutputs;
    const succeeded = [registry, sentiment, billing, webResearch].filter(
      (o) => o && (o.status === 'success' || o.status === 'partial')
    ).length;

    const registryRaw = (registry?.rawData ?? {}) as Record<string, unknown>;
    const sentimentRaw = (sentiment?.rawData ?? {}) as Record<string, unknown>;
    const billingRaw = (billing?.rawData ?? {}) as Record<string, unknown>;
    const webRaw = (webResearch?.rawData ?? {}) as Record<string, unknown>;

    const contradictions: Contradiction[] = [];
    const corroborations: string[] = [];

    // ---- Fraud corroboration across independent sources ----------------
    let fraudSources = 0;
    const fraudReasons: string[] = [];

    const billingFraud = num(billingRaw['fraudRiskScore'], 0);
    if (billingFraud >= 40 || ((billingRaw['fraudPatterns'] as unknown[] | undefined)?.length ?? 0) > 0) {
      fraudSources += 1;
      fraudReasons.push(`billing fraud-risk ${Math.round(billingFraud)}`);
    }

    const legalRisk = num(webRaw['legalRiskScore'], 0);
    const webSummary = (webRaw['summary'] ?? {}) as Record<string, unknown>;
    if (legalRisk >= 40 || num(webSummary['legalCases'], 0) > 0 || num(webSummary['regulatoryActions'], 0) > 0) {
      fraudSources += 1;
      fraudReasons.push('public legal/regulatory exposure');
    }

    const spam = (sentimentRaw['spamMetrics'] ?? {}) as Record<string, unknown>;
    const manipRisk = String(spam['manipulationRisk'] ?? 'low');
    if (manipRisk !== 'low') {
      fraudSources += 1;
      fraudReasons.push(`review manipulation risk: ${manipRisk}`);
    }

    const discrepancies = (registryRaw['discrepancies'] as unknown[] | undefined) ?? [];
    if (discrepancies.length > 0) {
      fraudSources += 1;
      fraudReasons.push(`${discrepancies.length} registry discrepancy(ies)`);
    }

    // ---- Contradiction checks -----------------------------------------
    const nabhStrength = num(registryRaw['nabhStrength'], 0);
    const clinicalQuality = num(sentimentRaw['clinicalQualityScore'], NaN);
    if (nabhStrength >= 1 && Number.isFinite(clinicalQuality) && clinicalQuality < 50) {
      contradictions.push({
        type: 'REGISTRY_VS_SENTIMENT',
        severity: 'medium',
        detail: 'Full NABH accreditation but patient-reported clinical quality is low.',
        agents: ['RegistryAgent', 'SentimentAgent'],
      });
    }

    const gicEmpanelledTrust = (registry?.signals ?? []).find((s) => s.dimension === 'gic_empanelled');
    const cashlessDenied = (billingRaw['fraudPatterns'] as Array<{ pattern?: string }> | undefined)?.some((p) =>
      String(p.pattern ?? '').toLowerCase().includes('cashless')
    );
    if (gicEmpanelledTrust?.value === 1 && cashlessDenied) {
      contradictions.push({
        type: 'BILLING_VS_REGISTRY',
        severity: 'high',
        detail: 'Facility is GIC-empanelled for cashless, yet reviews report cashless being denied.',
        agents: ['BillingAgent', 'RegistryAgent'],
      });
      if (!fraudReasons.includes('cashless contradiction')) {
        fraudReasons.push('cashless contradiction');
      }
    }

    // ---- Corroborations ------------------------------------------------
    if (billingFraud >= 40 && legalRisk >= 40) {
      corroborations.push('Billing fraud signal corroborated by public legal exposure.');
    }
    const patientExp = num(sentimentRaw['patientExperienceScore'], NaN);
    const webRep = num(webRaw['publicReputationScore'], NaN);
    if (Number.isFinite(patientExp) && Number.isFinite(webRep) && patientExp >= 75 && webRep >= 75) {
      corroborations.push('Strong patient experience corroborated by positive public reputation.');
    }

    // ---- Verdict -------------------------------------------------------
    let verdict: Verdict;
    if (succeeded < 3) {
      verdict = 'INSUFFICIENT_DATA';
    } else if (fraudSources >= 3) {
      verdict = 'ESCALATED';
    } else if (fraudSources >= 2 || contradictions.some((c) => c.severity === 'high')) {
      verdict = 'FLAGGED';
    } else if (fraudSources === 1 || contradictions.length > 0) {
      verdict = 'VALIDATED_WITH_NOTES';
    } else {
      verdict = 'VALIDATED';
    }

    const fraudConfidence =
      fraudSources >= 3 ? 0.95 : fraudSources === 2 ? 0.85 : fraudSources === 1 ? 0.6 : 0.9;

    return this.createOutput(input, 'success', [], Date.now() - t0, undefined, {
      verdict,
      agentsSucceeded: succeeded,
      fraudCorroboration: fraudSources,
      fraudReasons,
      fraudConfidence,
      contradictions,
      corroborations,
    });
  }
}
