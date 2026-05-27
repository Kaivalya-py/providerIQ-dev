import type { RawEvidence } from '../types/raw-evidence.types.js';

export interface ClassifiedEvidence {
  id: string;
  classifications: { aspect: string; sentiment: string; confidence: number }[];
}

export function classifyEvidence(records: RawEvidence[]): ClassifiedEvidence[] {
  return records.map((r) => {
    const aspects: { aspect: string; sentiment: string; confidence: number }[] = [];
    const text = (r.text ?? '').toLowerCase();

    // Simple keyword-based classification
    if (/wait|delay|queue|hour/.test(text)) aspects.push({ aspect: 'wait_time', sentiment: 'negative', confidence: 0.7 });
    if (/clean|hygien|dirty|filth/.test(text)) aspects.push({ aspect: 'facility', sentiment: text.match(/dirty|filth/) ? 'negative' : 'positive', confidence: 0.7 });
    if (/rude|staff|behav|attitud/.test(text)) aspects.push({ aspect: 'staff_behavior', sentiment: text.match(/rude|bad/) ? 'negative' : 'positive', confidence: 0.7 });
    if (/bill|charge|cost|expensive|money/.test(text)) aspects.push({ aspect: 'billing_issues', sentiment: 'negative', confidence: 0.7 });
    if (/doctor|treat|diagnos|surgery|care/.test(text)) aspects.push({ aspect: 'clinical_care', sentiment: (r.rating ?? 3) >= 4 ? 'positive' : 'negative', confidence: 0.75 });
    if (/communi|explain|inform|listen/.test(text)) aspects.push({ aspect: 'communication', sentiment: (r.rating ?? 3) >= 4 ? 'positive' : 'negative', confidence: 0.65 });
    if (/safe|infect|error|negligence/.test(text)) aspects.push({ aspect: 'safety_issue', sentiment: 'negative', confidence: 0.8 });
    if (/after|follow.?up|post.?op|recovery/.test(text)) aspects.push({ aspect: 'post_op', sentiment: (r.rating ?? 3) >= 4 ? 'positive' : 'negative', confidence: 0.65 });

    // Default if nothing matched
    if (aspects.length === 0) {
      const sentiment = (r.rating ?? 3) >= 4 ? 'positive' : (r.rating ?? 3) <= 2 ? 'negative' : 'neutral';
      aspects.push({ aspect: 'general', sentiment, confidence: 0.5 });
    }

    return { id: r.id, classifications: aspects };
  });
}

export interface Signal {
  id: string;
  facilityId: string;
  dimension: string;
  indicator: string;
  value: number;
  sentiment: string;
  confidence: number;
  evidenceId: string;
  text?: string;
}

export function mapClassifiedEvidenceToSignals(opts: {
  facilityId: string;
  classifiedEvidence: ClassifiedEvidence[];
  evidenceById: Map<string, RawEvidence>;
}): Signal[] {
  const { facilityId, classifiedEvidence, evidenceById } = opts;
  const signals: Signal[] = [];
  let idx = 0;

  for (const ce of classifiedEvidence) {
    const evidence = evidenceById.get(ce.id);
    for (const cl of ce.classifications) {
      signals.push({
        id: `sig-${idx++}`,
        facilityId,
        dimension: cl.aspect,
        indicator: `${cl.aspect}_${cl.sentiment}`,
        value: cl.sentiment === 'positive' ? 1 : cl.sentiment === 'negative' ? -1 : 0,
        sentiment: cl.sentiment,
        confidence: cl.confidence,
        evidenceId: ce.id,
        text: evidence?.text?.slice(0, 200),
      });
    }
  }

  return signals;
}
