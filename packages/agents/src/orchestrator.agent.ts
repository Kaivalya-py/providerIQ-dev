// ProviderIQ — Orchestrator Agent
// Coordinates the full multi-agent intelligence pipeline: dispatches Registry,
// Sentiment, Billing, and Web Research agents, runs the Supervisor to audit
// their findings, merges all signals, and runs the Scoring Engine.
// Powered by Inquantic.Ai

import { BaseAgent } from './base.agent.js';
import type { AgentInput, AgentOutput, SignalInput } from '@provideriq/shared';
import { ConnectorOrchestrator } from '@provideriq/connectors';
import { ScoringEngine } from '@provideriq/scoring';
import { prisma } from '@provideriq/database';
import { RegistryAgent, type RegistryAgentInput } from './registry.agent.js';
import { SentimentAgent, type SentimentAgentInput } from './sentiment.agent.js';
import { BillingAgent, type BillingAgentInput } from './billing.agent.js';
import { WebResearchAgent } from './webresearch.agent.js';
import { SupervisorAgent, type SupervisorAgentInput } from './supervisor.agent.js';

const MAX_REVIEWS = 150;

export class OrchestratorAgent extends BaseAgent {
  name = 'OrchestratorAgent';
  description = 'Coordinates full multi-agent intelligence gathering and scoring engine runs.';

  private connectors = new ConnectorOrchestrator();
  private scoring = new ScoringEngine();
  private registryAgent = new RegistryAgent();
  private sentimentAgent = new SentimentAgent();
  private billingAgent = new BillingAgent();
  private webResearchAgent = new WebResearchAgent();
  private supervisorAgent = new SupervisorAgent();

  /** Map an agent SignalInput to a Prisma Signal create payload. */
  private toDbSignal(facilityId: string, sig: SignalInput): Record<string, unknown> {
    return {
      facilityId,
      category: sig.category,
      dimension: sig.dimension,
      source: sig.source,
      sourceUrl: sig.sourceUrl,
      value: sig.value,
      valueText: sig.valueText,
      sentiment: sig.sentiment,
      weight: sig.weight ?? 1.0,
      confidence: sig.confidence ?? 1.0,
      capturedAt: sig.capturedAt ?? new Date(),
      rawData: (sig.rawData ?? (sig as any).metadata) as any,
    };
  }

  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    console.log(`[Orchestrator] Starting run ${input.runId} for facility ${input.facilityName}`);

    try {
      // 1. Load the facility record + recent reviews from the database.
      const facility = await prisma.facility.findUnique({ where: { id: input.facilityId } });
      if (!facility) {
        return this.createOutput(input, 'failed', [], Date.now() - startTime, `Facility ${input.facilityId} not found`);
      }

      const reviewRows = await prisma.review.findMany({
        where: { facilityId: input.facilityId, text: { not: null } },
        orderBy: { reviewDate: 'desc' },
        take: MAX_REVIEWS,
        select: { text: true, rating: true, reviewDate: true, source: true },
      });
      const reviews = reviewRows.map((r) => ({
        text: r.text ?? '',
        rating: r.rating ?? null,
        publishedAt: r.reviewDate ?? null,
        source: r.source,
      }));

      // 2. Dispatch the data-gathering agents in parallel.
      const registryInput: RegistryAgentInput = {
        ...input,
        facility: {
          abdmFacilityId: facility.abdmFacilityId,
          abdmReadiness: facility.abdmReadiness,
          nabhStatus: facility.nabhStatus,
          nabhGrade: facility.nabhGrade,
          nabhExpiryDate: facility.nabhExpiryDate,
          cghsEmpanelled: facility.cghsEmpanelled,
          echsEmpanelled: facility.echsEmpanelled,
          gicEmpanelled: facility.gicEmpanelled,
          bedCount: facility.bedCount,
          totalDoctors: facility.totalDoctors,
          totalNurses: facility.totalNurses,
          tier: facility.tier,
        },
      };
      const sentimentInput: SentimentAgentInput = { ...input, reviews };
      const billingInput: BillingAgentInput = {
        ...input,
        reviews,
        facilityContext: {
          nabhGrade: facility.nabhGrade,
          tier: facility.tier,
          gicEmpanelled: facility.gicEmpanelled,
          cghsEmpanelled: facility.cghsEmpanelled,
          bedCount: facility.bedCount,
        },
      };

      const [registryOut, sentimentOut, billingOut, webOut] = await Promise.all([
        this.registryAgent.execute(registryInput),
        this.sentimentAgent.execute(sentimentInput),
        this.billingAgent.execute(billingInput),
        this.webResearchAgent.execute(input),
      ]);

      // 3. Supervisor audits the gathered findings.
      const supervisorInput: SupervisorAgentInput = {
        ...input,
        agentOutputs: {
          registry: registryOut,
          sentiment: sentimentOut,
          billing: billingOut,
          webResearch: webOut,
        },
      };
      const supervisorOut = await this.supervisorAgent.execute(supervisorInput);

      // 4. Optionally enrich with external connectors (non-fatal).
      const VALID_CATEGORIES = new Set(['TRUST', 'OPERATIONAL', 'BILLING', 'CLINICAL', 'PATIENT', 'FRAUD']);
      let connectorSignals: SignalInput[] = [];
      try {
        const connectorResults = await this.connectors.runAll(input.facilityName, input.city, input.state);
        connectorSignals = connectorResults
          .filter((r) => r.status === 'success')
          .flatMap((r) => r.signals)
          // Drop signals whose category is not part of the scoring taxonomy
          // (e.g. the live scraper's 'REPUTATION' rollups).
          .filter((s) => VALID_CATEGORIES.has(s.category as string));
      } catch (err) {
        console.warn(`[Orchestrator] Connectors skipped: ${String(err)}`);
      }

      // 5. Merge all agent + connector signals.
      const agentSignals: SignalInput[] = [
        ...registryOut.signals,
        ...sentimentOut.signals,
        ...billingOut.signals,
        ...webOut.signals,
        ...connectorSignals,
      ];

      // 6. Replace this facility's prior signals with the fresh run, then persist.
      await prisma.signal.deleteMany({ where: { facilityId: input.facilityId } });
      const dbSignals = agentSignals.map((s) => this.toDbSignal(input.facilityId, s));
      if (dbSignals.length > 0) {
        await prisma.signal.createMany({ data: dbSignals as any });
      }

      // 7. Fetch all active signals for the facility to run scoring
      const allSignals = await prisma.signal.findMany({
        where: {
          facilityId: input.facilityId,
          isDecayed: false,
        },
      });

      const mappedSignals = allSignals.map((sig: any) => ({
        ...sig,
        value: sig.value ?? undefined,
        sourceUrl: sig.sourceUrl ?? undefined,
        valueText: sig.valueText ?? undefined,
        sentiment: sig.sentiment ?? undefined,
        expiresAt: sig.expiresAt ?? undefined,
        rawData: sig.rawData as any,
      }));

      // 5. Run Scoring Engine compute
      const scoringResult = this.scoring.compute({
        facilityId: input.facilityId,
        signals: mappedSignals,
        facility: {
          id: input.facilityId,
          name: input.facilityName,
          city: input.city,
          state: input.state,
          tier: 'TIER_2', // default/simulated
          facilityType: 'HOSPITAL',
          specialties: ['General Medicine'],
        },
      });

      // 6. Update facility record with newly computed PII score details
      await prisma.facility.update({
        where: { id: input.facilityId },
        data: {
          piiScore: scoringResult.piiScore,
          trustScore: scoringResult.dimensions.trust.score,
          operationalScore: scoringResult.dimensions.operational.score,
          billingStabilityScore: scoringResult.dimensions.billingStability.score,
          clinicalQualityScore: scoringResult.dimensions.clinicalQuality.score,
          patientExperienceScore: scoringResult.dimensions.patientExperience.score,
          fraudRiskScore: scoringResult.dimensions.fraudRisk.score,
          scoreUpdatedAt: new Date(),
        },
      });

      // 7. Write run history record
      await prisma.scoreHistory.create({
        data: {
          facilityId: input.facilityId,
          piiScore: scoringResult.piiScore,
          trustScore: scoringResult.dimensions.trust.score,
          operationalScore: scoringResult.dimensions.operational.score,
          billingStabilityScore: scoringResult.dimensions.billingStability.score,
          clinicalQualityScore: scoringResult.dimensions.clinicalQuality.score,
          patientExperienceScore: scoringResult.dimensions.patientExperience.score,
          fraudRiskScore: scoringResult.dimensions.fraudRisk.score,
          snapshotReason: 'triggered_research',
        },
      });

      return this.createOutput(
        input,
        'success',
        [],
        Date.now() - startTime,
        undefined,
        {
          scoringResult: scoringResult as any,
          agents: {
            registry: { status: registryOut.status, signals: registryOut.signals.length, rawData: registryOut.rawData },
            sentiment: { status: sentimentOut.status, signals: sentimentOut.signals.length, rawData: sentimentOut.rawData },
            billing: { status: billingOut.status, signals: billingOut.signals.length, rawData: billingOut.rawData },
            webResearch: { status: webOut.status, signals: webOut.signals.length, rawData: webOut.rawData },
            supervisor: { status: supervisorOut.status, rawData: supervisorOut.rawData },
          },
          signalsPersisted: dbSignals.length,
          reviewsAnalysed: reviews.length,
        }
      );
    } catch (err: unknown) {
      console.error(`[Orchestrator] Run failed: ${String(err)}`);
      return this.createOutput(input, 'failed', [], Date.now() - startTime, String(err));
    }
  }
}
