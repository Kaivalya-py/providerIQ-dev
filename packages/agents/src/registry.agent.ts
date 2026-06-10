// ProviderIQ — Registry Agent
// Deterministic validation of facility credentials from authoritative registry
// fields. Emits TRUST + OPERATIONAL signals. No LLM call — always available.
// Powered by Inquantic.Ai

import type { AgentInput, AgentOutput, SignalInput } from '@provideriq/shared';
import { BaseAgent } from './base.agent.js';

/** Registry-relevant fields pulled from the Facility record. */
export interface RegistryFacilityData {
  abdmFacilityId?: string | null;
  abdmReadiness?: boolean | null;
  nabhStatus?: string | null; // NabhStatus enum string
  nabhGrade?: string | null;
  nabhExpiryDate?: string | Date | null;
  cghsEmpanelled?: boolean | null;
  echsEmpanelled?: boolean | null;
  gicEmpanelled?: boolean | null;
  bedCount?: number | null;
  totalDoctors?: number | null;
  totalNurses?: number | null;
  tier?: string | null;
}

export interface RegistryAgentInput extends AgentInput {
  facility: RegistryFacilityData;
}

export interface RegistryDiscrepancy {
  type: string;
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Maps a NABH status string to an accreditation strength in [0, 1]. */
function nabhStrength(status?: string | null): number {
  switch ((status ?? '').toUpperCase()) {
    case 'ACCREDITED_FULL':
      return 1.0;
    case 'ACCREDITED_PROGRESSIVE':
      return 0.8;
    case 'ACCREDITED_ENTRY':
      return 0.6;
    default:
      return 0.0; // NOT_ACCREDITED, EXPIRED, unknown
  }
}

function monthsUntil(date?: string | Date | null): number | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30);
}

export class RegistryAgent extends BaseAgent {
  name = 'RegistryAgent';
  description = 'Validates facility credentials across registries → TRUST + OPERATIONAL signals';

  async execute(input: AgentInput): Promise<AgentOutput> {
    const t0 = Date.now();
    const { facility } = input as RegistryAgentInput;

    if (!facility) {
      return this.createOutput(input, 'failed', [], Date.now() - t0, 'No facility data provided to RegistryAgent');
    }

    const signals: SignalInput[] = [];
    const discrepancies: RegistryDiscrepancy[] = [];

    // ---- TRUST signals -------------------------------------------------
    const abdmRegistered = Boolean(facility.abdmFacilityId) || Boolean(facility.abdmReadiness);
    signals.push({
      category: 'TRUST',
      dimension: 'abdm_registered',
      source: 'ABDM',
      value: abdmRegistered ? 1 : 0,
      confidence: 0.95,
    });

    const nabh = nabhStrength(facility.nabhStatus);
    const expiryMonths = monthsUntil(facility.nabhExpiryDate);
    let nabhValue = nabh;
    if (nabh > 0 && expiryMonths !== null && expiryMonths < 6) {
      // Accreditation is valid but expiring soon → soften the signal.
      nabhValue = Math.max(0, nabh - 0.2);
      discrepancies.push({
        type: 'ACCREDITATION_EXPIRING',
        severity: 'medium',
        detail:
          expiryMonths < 0
            ? 'NABH accreditation appears to have lapsed.'
            : `NABH accreditation expires in under 6 months (~${Math.max(0, Math.round(expiryMonths))} mo).`,
      });
    }
    signals.push({
      category: 'TRUST',
      dimension: 'nabh_accredited',
      source: 'NABH',
      value: nabhValue,
      valueText: facility.nabhGrade ?? facility.nabhStatus ?? undefined,
      confidence: 0.95,
    });

    signals.push({
      category: 'TRUST',
      dimension: 'gic_empanelled',
      source: 'GIC',
      value: facility.gicEmpanelled ? 1 : 0,
      confidence: 0.9,
    });

    signals.push({
      category: 'TRUST',
      dimension: 'cghs_empanelled',
      source: 'CGHS',
      value: facility.cghsEmpanelled ? 1 : 0,
      confidence: 0.85,
    });

    // ---- OPERATIONAL signals ------------------------------------------
    signals.push({
      category: 'OPERATIONAL',
      dimension: 'digital_readiness',
      source: 'ABDM',
      value: abdmRegistered ? 1 : 0,
      confidence: 0.85,
    });

    const bedCount = facility.bedCount ?? 0;
    if (bedCount > 0) {
      // Treat ~200 beds as a "fully resourced" reference point.
      signals.push({
        category: 'OPERATIONAL',
        dimension: 'bed_capacity',
        source: 'ABDM',
        value: clamp((bedCount / 200) * 100, 0, 100) / 100,
        valueText: `${bedCount} beds`,
        confidence: 0.8,
      });
    }

    const docs = facility.totalDoctors ?? 0;
    let docBedRatio: number | null = null;
    if (bedCount > 0 && docs > 0) {
      docBedRatio = docs / bedCount;
      // ~0.25 doctors-per-bed treated as adequately staffed.
      signals.push({
        category: 'OPERATIONAL',
        dimension: 'staffing_adequacy',
        source: 'NMC',
        value: clamp((docBedRatio / 0.25) * 100, 0, 100) / 100,
        valueText: `${docs} doctors / ${bedCount} beds`,
        confidence: 0.75,
      });
      if (docBedRatio < 0.15) {
        discrepancies.push({
          type: 'UNDERSTAFFED',
          severity: 'medium',
          detail: `Doctor-to-bed ratio ${docBedRatio.toFixed(2)} is below the 0.15 adequacy threshold.`,
        });
      }
    }

    // ---- Aggregate scores (explainable rubric) ------------------------
    let trustScore = 0;
    if (abdmRegistered) trustScore += 25;
    trustScore += nabh === 1 ? 30 : nabh === 0.8 ? 20 : nabh === 0.6 ? 10 : 0;
    if (facility.gicEmpanelled) trustScore += 15;
    if (facility.cghsEmpanelled) trustScore += 10;
    if (docs > 0) trustScore += 10;
    if (discrepancies.length === 0) trustScore += 10;
    if (expiryMonths !== null && expiryMonths < 6) trustScore -= 5;
    if (docBedRatio !== null && docBedRatio < 0.15) trustScore -= 10;
    trustScore = clamp(trustScore);

    let operationalScore = 0;
    if (abdmRegistered) operationalScore += 30;
    if (nabh > 0) operationalScore += 25;
    if (facility.gicEmpanelled) operationalScore += 20;
    if (docBedRatio !== null && docBedRatio > 0.25) operationalScore += 10;
    operationalScore += 15; // data freshness (registry fields present)
    operationalScore = clamp(operationalScore);

    return this.createOutput(input, 'success', signals, Date.now() - t0, undefined, {
      trustScore,
      operationalScore,
      discrepancies,
      abdmRegistered,
      nabhStrength: nabh,
      doctorBedRatio: docBedRatio,
    });
  }
}
