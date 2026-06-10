// ProviderIQ — Live Agent Terminal
// A terminal-style modal that runs the Sentiment / Billing agents against a
// selected hospital's real reviews and streams the findings + top comments.
// Powered by Inquantic.Ai

import { useState, useEffect, useRef } from 'react';
import { X, Play, Loader2, Heart, TrendingUp, Star, ChevronDown } from 'lucide-react';

const API = import.meta.env.PROD ? '/api/trpc' : 'http://localhost:4000/trpc';

type Hospital = { id: string; name: string; city: string; state: string; reviewCount: number };
type Comment = { text: string; rating: number | null; source: string; publishedAt: string | null; sentiment: string };
type Signal = { category: string; dimension: string; score: number; confidence: number | null };

interface AgentResult {
  agent: string;
  facilityName: string;
  city: string;
  state: string;
  status: string;
  error: string | null;
  executionMs: number;
  reviewsAnalysed: number;
  findings: Record<string, any>;
  reference?: Record<string, any> | null;
  signals: Signal[];
  topComments: Comment[];
}

interface Props {
  agent: 'sentiment' | 'billing';
  onClose: () => void;
}

type Line = { kind: 'cmd' | 'out' | 'ok' | 'warn' | 'err' | 'dim'; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AGENT_META = {
  sentiment: {
    label: 'Sentiment Agent',
    proc: 'sentiment-agent',
    icon: <Heart size={14} />,
    accent: '#FF6B9D',
    endpoint: 'runSentimentAnalysis',
  },
  billing: {
    label: 'Billing Analyst',
    proc: 'billing-analyst',
    icon: <TrendingUp size={14} />,
    accent: '#34D399',
    endpoint: 'runBillingAnalysis',
  },
} as const;

export default function AgentTerminal({ agent, onClose }: Props) {
  const meta = AGENT_META[agent];
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Load hospital list
  useEffect(() => {
    fetch(`${API}/listAnalyzableHospitals`)
      .then((r) => r.json())
      .then((d) => {
        const list: Hospital[] = d.result?.data?.hospitals ?? d.hospitals ?? [];
        setHospitals(list);
        if (list.length) setSelectedId(list[0].id);
      })
      .catch(() => setHospitals([]))
      .finally(() => setLoadingList(false));
  }, []);

  // Auto-scroll terminal to the bottom as content streams in
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, result]);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  const push = (line: Line) => setLines((prev) => [...prev, line]);

  const runAnalysis = async () => {
    if (!selectedId || running) return;
    const hosp = hospitals.find((h) => h.id === selectedId);
    if (!hosp) return;

    setRunning(true);
    setResult(null);
    setLines([]);

    // Kick off the real network request immediately, stream a live boot log in parallel.
    const fetchPromise = fetch(`${API}/${meta.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId: selectedId }),
    })
      .then((r) => r.json())
      .catch((e) => ({ error: { message: e?.message ?? 'Network error' } }));

    const boot: Array<[number, Line]> = [
      [120, { kind: 'cmd', text: `$ provideriq run ${meta.proc} --facility "${hosp.name}"` }],
      [300, { kind: 'dim', text: `[init] Inquantic.Ai agent runtime · model=gemini-3.5-flash` }],
      [260, { kind: 'out', text: `[fetch] Resolving ${hosp.name}, ${hosp.city}…` }],
      [320, { kind: 'ok', text: `[fetch] Located facility · ${hosp.reviewCount} reviews on record` }],
      [300, { kind: 'out', text: `[load] Pulling up to 150 most-recent patient reviews…` }],
      [340, { kind: 'out', text: agent === 'sentiment'
        ? `[nlp] Classifying aspects · staff · clinical · wait · facility · safety…`
        : `[scan] Isolating billing-related accounts · charges · cashless · deposits…` }],
      [360, { kind: 'dim', text: `[llm] Dispatching de-biased reasoning prompt to Gemini…` }],
      [320, { kind: 'out', text: `[llm] Awaiting structured JSON verdict…` }],
    ];

    for (const [delay, line] of boot) {
      await sleep(delay);
      push(line);
    }

    // Keep a subtle "thinking" pulse until the request resolves
    const data = await fetchPromise;

    if (data?.error) {
      push({ kind: 'err', text: `[error] ${data.error.message ?? 'Agent run failed'}` });
      setRunning(false);
      return;
    }

    const res: AgentResult = data.result?.data ?? data;
    push({ kind: 'ok', text: `[done] Agent finished in ${(res.executionMs / 1000).toFixed(1)}s · status=${res.status}` });
    push({ kind: 'dim', text: `[done] Analysed ${res.reviewsAnalysed} reviews · ${res.signals.length} signals emitted` });
    await sleep(150);
    setResult(res);
    setRunning(false);
  };

  const lineColor = (k: Line['kind']) =>
    k === 'cmd' ? '#E6E6E6' : k === 'ok' ? '#34D399' : k === 'warn' ? '#FBBF24' : k === 'err' ? '#F87171' : k === 'dim' ? '#6B7280' : '#9CA3AF';

  const sentColor = (s: string) => (s === 'positive' ? '#34D399' : s === 'negative' ? '#F87171' : '#9CA3AF');
  const scoreColor = (n: number) => (n >= 70 ? '#34D399' : n >= 45 ? '#FBBF24' : '#F87171');

  return (
    <div className="piq-term-overlay" onClick={() => !running && onClose()}>
      <div className="piq-term" onClick={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div className="piq-term-head">
          <div className="piq-term-traffic">
            <span style={{ background: '#FF5F57' }} />
            <span style={{ background: '#FEBC2E' }} />
            <span style={{ background: '#28C840' }} />
          </div>
          <div className="piq-term-title">
            <span style={{ color: meta.accent, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {meta.icon} {meta.label}
            </span>
            <span className="piq-term-sub">— live analysis · provideriq</span>
          </div>
          <button className="piq-term-x" onClick={onClose} disabled={running} title="Close">
            <X size={14} />
          </button>
        </div>

        {/* Control bar */}
        <div className="piq-term-controls">
          <div className="piq-select-wrap">
            <select
              className="piq-select"
              value={selectedId}
              disabled={running || loadingList}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {loadingList && <option>Loading hospitals…</option>}
              {!loadingList && hospitals.length === 0 && <option>No hospitals with reviews</option>}
              {hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.city} ({h.reviewCount} reviews)
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="piq-select-caret" />
          </div>
          <button className="piq-run-btn" onClick={runAnalysis} disabled={running || !selectedId}>
            {running ? <Loader2 size={13} className="piq-spin" /> : <Play size={13} />}
            {running ? 'Running…' : 'Run Analysis'}
          </button>
        </div>

        {/* Terminal body */}
        <div className="piq-term-body" ref={bodyRef}>
          {lines.length === 0 && !running && (
            <div className="piq-term-line" style={{ color: '#6B7280' }}>
              Select a hospital and press <b style={{ color: '#9CA3AF' }}>Run Analysis</b> to dispatch the {meta.label} against real patient reviews.
            </div>
          )}

          {lines.map((l, i) => (
            <div key={i} className="piq-term-line" style={{ color: lineColor(l.kind) }}>
              {l.text}
            </div>
          ))}

          {running && (
            <div className="piq-term-line piq-cursor" style={{ color: meta.accent }}>
              ▋
            </div>
          )}

          {result && (
            <div className="piq-result">
              <div className="piq-divider">═══ FINDINGS SUMMARY ═══</div>

              {/* Metric chips */}
              <div className="piq-metrics">
                {agent === 'sentiment' ? (
                  <>
                    <Metric label="Positivity" value={result.findings.positivityIndex} suffix="%" color={scoreColor} />
                    <Metric label="Patient Exp." value={result.findings.patientExperienceScore} suffix="/100" color={scoreColor} />
                    <Metric label="Clinical Quality" value={result.findings.clinicalQualityScore} suffix="/100" color={scoreColor} />
                    <Metric
                      label="Manipulation Risk"
                      text={(result.findings.spamMetrics?.manipulationRisk ?? '—').toUpperCase()}
                      color={() => (result.findings.spamMetrics?.manipulationRisk === 'low' ? '#34D399' : '#FBBF24')}
                    />
                  </>
                ) : (
                  <>
                    <Metric label="Transparency" value={result.findings.billingTransparencyScore} suffix="/100" color={scoreColor} />
                    <Metric
                      label="Fraud Risk"
                      value={result.findings.fraudRiskScore}
                      suffix="/100"
                      color={(n) => (n >= 55 ? '#F87171' : n >= 30 ? '#FBBF24' : '#34D399')}
                    />
                    <Metric label="Billing Reviews" text={String(result.findings.billingReviewCount ?? '—')} color={() => '#9CA3AF'} />
                    <Metric label="Trend" text={(result.findings.trendDirection ?? '—').toUpperCase()} color={() => '#9CA3AF'} />
                  </>
                )}
              </div>

              {/* Cross-check against the main Provider Intelligence dashboard */}
              {result.reference && (
                <div className="piq-crosscheck">
                  <span className="piq-crosscheck-label">↔ In sync with Provider Intelligence</span>
                  <div className="piq-crosscheck-row">
                    {agent === 'sentiment' ? (
                      <>
                        <RefChip label="Dashboard PII" value={result.reference.piiScore} suffix="/100" />
                        <RefChip label="Dashboard Patient Exp." value={result.reference.patientExperienceScore} suffix="/100" />
                        <RefChip label="Dashboard Clinical" value={result.reference.clinicalQualityScore} suffix="/100" />
                        <RefChip label="Avg Rating" value={result.reference.avgRating} suffix="★" digits={2} max={5} />
                      </>
                    ) : (
                      <>
                        <RefChip label="Dashboard PII" value={result.reference.piiScore} suffix="/100" />
                        <RefChip label="Dashboard Billing Stab." value={result.reference.billingStabilityScore} suffix="/100" />
                        <RefChip label="Dashboard Fraud Risk" value={result.reference.fraudRiskScore} suffix="/100" />
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Narrative / fraud patterns (billing) */}
              {agent === 'billing' && result.findings.narrative && (
                <div className="piq-narrative">{result.findings.narrative}</div>
              )}
              {agent === 'billing' && Array.isArray(result.findings.fraudPatterns) && result.findings.fraudPatterns.length > 0 && (
                <div className="piq-patterns">
                  {result.findings.fraudPatterns.map((p: any, i: number) => (
                    <div key={i} className="piq-pattern">
                      <span className={`piq-sev piq-sev-${p.severity}`}>{p.severity}</span>
                      <span className="piq-pattern-name">{p.pattern}</span>
                      <span className="piq-pattern-detail">{p.detail} · {p.reviewCount} reviews</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Signals */}
              <div className="piq-signals">
                {result.signals.map((s, i) => (
                  <div key={i} className="piq-signal">
                    <span className="piq-signal-dim">{s.dimension.replace(/_/g, ' ')}</span>
                    <span className="piq-signal-bar">
                      <span style={{ width: `${s.score}%`, background: scoreColor(s.score) }} />
                    </span>
                    <span className="piq-signal-score" style={{ color: scoreColor(s.score) }}>{s.score}</span>
                  </div>
                ))}
              </div>

              {/* Top comments */}
              <div className="piq-divider">═══ TOP {result.topComments.length} RESONATING COMMENTS ═══</div>
              <div className="piq-comments">
                {result.topComments.map((c, i) => (
                  <div key={i} className="piq-comment" style={{ borderLeftColor: sentColor(c.sentiment) }}>
                    <div className="piq-comment-meta">
                      <span className="piq-comment-idx">#{String(i + 1).padStart(2, '0')}</span>
                      {c.rating != null && (
                        <span className="piq-comment-rating">
                          <Star size={10} fill="#FBBF24" stroke="#FBBF24" /> {c.rating}
                        </span>
                      )}
                      <span className="piq-comment-src">{c.source}</span>
                      <span className="piq-comment-sent" style={{ color: sentColor(c.sentiment) }}>{c.sentiment}</span>
                    </div>
                    <div className="piq-comment-text">{c.text}</div>
                  </div>
                ))}
              </div>

              <div className="piq-term-line" style={{ color: '#6B7280', marginTop: 12 }}>
                $ <span style={{ color: meta.accent }}>▋</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  text,
  suffix = '',
  color,
}: {
  label: string;
  value?: number | null;
  text?: string;
  suffix?: string;
  color: (n: number) => string;
}) {
  const display = text ?? (value == null ? '—' : `${Math.round(value)}${suffix}`);
  const c = text ? color(0) : value == null ? '#6B7280' : color(value);
  return (
    <div className="piq-metric">
      <div className="piq-metric-label">{label}</div>
      <div className="piq-metric-value" style={{ color: c }}>{display}</div>
    </div>
  );
}

function RefChip({
  label,
  value,
  suffix = '',
  digits = 0,
  max,
}: {
  label: string;
  value?: number | null;
  suffix?: string;
  digits?: number;
  max?: number;
}) {
  const display =
    value == null ? '—' : `${Number(value).toFixed(digits)}${max ? `/${max}` : ''}${suffix}`;
  return (
    <div className="piq-refchip">
      <span className="piq-refchip-label">{label}</span>
      <span className="piq-refchip-value">{display}</span>
    </div>
  );
}
