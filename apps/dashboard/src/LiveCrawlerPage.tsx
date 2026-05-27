import { useState, useRef, useEffect } from 'react';
import { Activity, Search, Terminal, Layers, ChevronRight, Clock, Database, Filter, BarChart2, Zap, ShieldCheck, CheckCircle2, Loader2 } from 'lucide-react';

const API = import.meta.env.PROD ? '/api/trpc' : 'http://localhost:4000/trpc';

type StepStatus = 'pending' | 'active' | 'done';

interface PipelineStep {
  name: string;
  description: string;
  durationMs: number;
  inputCount: number;
  outputCount: number;
  detail: Record<string, unknown>;
}

interface RunResult {
  runId: string;
  hospitalName: string;
  city: string;
  collected: number;
  accepted: number;
  rejected: number;
  duplicatesRemoved: number;
  signalCount: number;
  score: number;
  dimensions: Record<string, any>;
  positiveFactors: string[];
  negativeFactors: string[];
  confidence: number;
  narrative: string;
  sampleReviews: any[];
  provenance: {
    totalDurationMs: number;
    steps: PipelineStep[];
  };
}

const STEP_ICONS = [
  <Search size={16} />,
  <Database size={16} />,
  <Filter size={16} />,
  <Layers size={16} />,
  <Zap size={16} />,
  <ShieldCheck size={16} />,
];

const STEP_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#0EA5E9'];

export default function LiveCrawlerPage() {
  const [hospitalName, setHospitalName] = useState('');
  const [city, setCity] = useState('');
  const [maxReviews, setMaxReviews] = useState(100);

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState('');

  // Progressive reveal: which step index is currently "active"
  const [activeStepIdx, setActiveStepIdx] = useState(-1);
  const [logs, setLogs] = useState<{ time: string; msg: string; type: 'info' | 'success' | 'warn' | 'layer' }[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const addLog = (msg: string, type: 'info' | 'success' | 'warn' | 'layer' = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString([], { hour12: false }), msg, type }]);
  };

  const runPipeline = async () => {
    if (!hospitalName.trim() || !city.trim()) return;
    setStatus('running');
    setResult(null);
    setError('');
    setLogs([]);
    setActiveStepIdx(0);
    setElapsed(0);

    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Date.now() - t0), 100);

    addLog(`Pipeline initiated for "${hospitalName}", ${city}`, 'info');
    addLog(`Resolving hospital identity via Apify actor...`, 'layer');

    // Simulate progressive layer activation while waiting
    const layerMessages = [
      'Querying Google Maps reviews via headless scraper...',
      'Running content-hash deduplication...',
      'Applying quality gate filters (spam, empty, bot)...',
      'Classifying aspects & sentiment per review...',
      'Extracting scorable signals per dimension...',
      'Computing weighted PII score...',
    ];

    let stepTimer: ReturnType<typeof setInterval> | null = null;
    let currentStep = 0;
    stepTimer = setInterval(() => {
      currentStep++;
      if (currentStep < layerMessages.length) {
        setActiveStepIdx(currentStep);
        addLog(layerMessages[currentStep], 'layer');
      } else if (stepTimer) {
        clearInterval(stepTimer);
      }
    }, 3000);

    try {
      const response = await fetch(`${API}/runAcquisition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospitalName: hospitalName.trim(), city: city.trim(), maxReviews }),
      });

      if (stepTimer) clearInterval(stepTimer);
      if (timerRef.current) clearInterval(timerRef.current);

      const data = await response.json();
      if (data.error) throw new Error(data.error.message || 'Pipeline failed');

      const res: RunResult = data.result?.data ?? data;
      setResult(res);
      setActiveStepIdx(res.provenance.steps.length - 1);
      setElapsed(res.provenance.totalDurationMs);
      setStatus('done');

      addLog(`Pipeline complete — PII Score: ${res.score.toFixed(1)} (${res.confidence} confidence)`, 'success');
      addLog(`${res.provenance.steps.length} layers processed in ${(res.provenance.totalDurationMs / 1000).toFixed(1)}s`, 'success');
    } catch (e: any) {
      if (stepTimer) clearInterval(stepTimer);
      if (timerRef.current) clearInterval(timerRef.current);
      setError(e.message);
      setStatus('error');
      addLog(`Error: ${e.message}`, 'warn');
    }
  };

  const getStepStatus = (idx: number): StepStatus => {
    if (!result) return idx <= activeStepIdx ? (idx === activeStepIdx ? 'active' : 'done') : 'pending';
    return 'done';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '24px 32px', boxSizing: 'border-box', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers color="var(--blue)" size={22} /> Pipeline Deep Trace
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            Watch data flow through each processing layer — fetch → dedupe → quality → classify → signals → score
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Hospital</label>
            <input value={hospitalName} onChange={e => setHospitalName(e.target.value)} placeholder="e.g. Manipal Hospital Whitefield" style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: '0.78rem', width: 240 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>City</label>
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Bengaluru" style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: '0.78rem', width: 140 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Reviews</label>
            <input type="number" value={maxReviews} onChange={e => setMaxReviews(Number(e.target.value))} min={5} max={500} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: '0.78rem', width: 70 }} />
          </div>
          <button onClick={runPipeline} disabled={status === 'running' || !hospitalName || !city} style={{
            height: 35, padding: '0 20px', borderRadius: 20, border: 'none',
            background: status === 'running' ? '#94A3B8' : 'var(--blue)', color: '#fff',
            fontWeight: 700, fontSize: '0.75rem', cursor: status === 'running' ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: status === 'running' ? 'none' : '0 4px 12px rgba(29,78,216,0.3)',
          }}>
            {status === 'running' ? <Loader2 size={14} className="spinning" /> : <Activity size={14} />}
            {status === 'running' ? 'Processing...' : 'Run Deep Analysis'}
          </button>
        </div>
      </div>

      {/* Main: Pipeline Steps (left) + Terminal (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, flex: 1, overflow: 'hidden' }}>

        {/* Left: Pipeline Step Trace */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>
          <div style={{ padding: '12px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={14} color="var(--blue)" />
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>PROCESSING LAYERS</span>
            </div>
            {status !== 'idle' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                <Clock size={12} />
                {(elapsed / 1000).toFixed(1)}s
              </div>
            )}
          </div>

          <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {status === 'idle' && (
              <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 60, fontSize: '0.85rem' }}>
                Enter a hospital name and city, then click <strong>Run Deep Analysis</strong> to see data flow through each layer.
              </div>
            )}

            {status !== 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {(result ? result.provenance.steps : layerPlaceholders).map((stepData, idx) => {
                  const stepStatus = getStepStatus(idx);
                  const realStep = result?.provenance.steps[idx];
                  const color = STEP_COLORS[idx % STEP_COLORS.length];

                  return (
                    <div key={idx}>
                      {/* Connector line */}
                      {idx > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 19, height: 28 }}>
                          <div style={{ width: 2, height: '100%', background: stepStatus === 'pending' ? '#E2E8F0' : color, opacity: stepStatus === 'pending' ? 0.4 : 0.6, transition: '0.3s' }} />
                          {stepStatus === 'done' && realStep && (
                            <div style={{ marginLeft: 16, fontSize: '0.6rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <ChevronRight size={10} /> {realStep.inputCount} → {realStep.outputCount} records
                            </div>
                          )}
                        </div>
                      )}

                      {/* Step card */}
                      <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: 14,
                        padding: '14px 16px', borderRadius: 12,
                        background: stepStatus === 'active' ? `${color}08` : stepStatus === 'done' ? '#F8FAFC' : '#fff',
                        border: `1px solid ${stepStatus === 'active' ? color : stepStatus === 'done' ? '#E2E8F0' : '#F1F5F9'}`,
                        transition: 'all 0.3s',
                        boxShadow: stepStatus === 'active' ? `0 4px 12px ${color}15` : 'none',
                      }}>
                        {/* Icon circle */}
                        <div style={{
                          width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          background: stepStatus === 'done' ? color : stepStatus === 'active' ? `${color}20` : '#F1F5F9',
                          color: stepStatus === 'done' ? '#fff' : stepStatus === 'active' ? color : '#94A3B8',
                          transition: '0.3s',
                        }}>
                          {stepStatus === 'done' ? <CheckCircle2 size={18} /> : stepStatus === 'active' ? <Loader2 size={16} className="spinning" /> : STEP_ICONS[idx]}
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: stepStatus === 'pending' ? '#94A3B8' : '#0F172A' }}>
                              {realStep?.name ?? stepData.name}
                            </span>
                            {realStep && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#64748B', background: '#F1F5F9', padding: '2px 8px', borderRadius: 10 }}>
                                {realStep.durationMs < 1000 ? `${realStep.durationMs}ms` : `${(realStep.durationMs / 1000).toFixed(1)}s`}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#64748B', marginBottom: realStep ? 8 : 0 }}>
                            {realStep?.description ?? stepData.description}
                          </div>

                          {/* Detail chips for completed steps */}
                          {realStep && stepStatus === 'done' && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                              {renderStepDetail(realStep, color)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Final score card */}
                {result && (
                  <div style={{ marginTop: 20, padding: 20, borderRadius: 14, background: 'linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)', color: '#fff', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Provider Intelligence Index</div>
                    <div style={{ fontSize: '2.8rem', fontWeight: 900, margin: '6px 0' }}>{result.score.toFixed(1)}</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>{result.narrative}</div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 14, fontSize: '0.7rem', opacity: 0.85 }}>
                      <span>{result.collected} fetched</span>
                      <span>{result.accepted} accepted</span>
                      <span>{result.signalCount} signals</span>
                      <span>{result.confidence} confidence</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Agent Terminal Logs */}
        <div className="glass-panel dark" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={14} color="#10B981" />
            <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#10B981' }}>PIPELINE TRACE LOG</span>
          </div>
          <div className="custom-scrollbar dark-scroll" style={{ flex: 1, overflowY: 'auto', padding: 16, fontSize: '0.73rem', fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.7 }}>
            {logs.length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.3)' }}>$ Awaiting pipeline execution...</div>
            )}
            {logs.map((l, i) => {
              let color = '#E5E7EB';
              if (l.type === 'warn') color = '#EF4444';
              if (l.type === 'success') color = '#10B981';
              if (l.type === 'layer') color = '#60A5FA';
              return (
                <div key={i} style={{ marginBottom: 4, color, animation: 'fadeIn 0.3s ease-out' }}>
                  <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: 8 }}>[{l.time}]</span>
                  {l.type === 'layer' && <span style={{ color: '#8B5CF6', marginRight: 6 }}>▶</span>}
                  {l.msg}
                </div>
              );
            })}

            {status === 'running' && (
              <div style={{ marginTop: 8, color: '#10B981', animation: 'pulse-data 1s infinite' }}>_</div>
            )}

            {/* Show provenance details in terminal after completion */}
            {result && (
              <>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 12, paddingTop: 12 }} />
                <div style={{ color: '#8B5CF6', marginBottom: 6, fontWeight: 700 }}>─── Provenance Summary ───</div>
                {result.provenance.steps.map((step, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ color: STEP_COLORS[i % STEP_COLORS.length] }}>
                      Layer {i + 1}: {step.name} <span style={{ color: 'rgba(255,255,255,0.4)' }}>({step.durationMs}ms)</span>
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.5)', paddingLeft: 12 }}>
                      {step.inputCount} in → {step.outputCount} out | {step.description}
                    </div>
                    {Object.keys(step.detail).length > 0 && (
                      <pre style={{ color: 'rgba(255,255,255,0.35)', paddingLeft: 12, margin: '2px 0', fontSize: '0.65rem' }}>
                        {JSON.stringify(step.detail, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
                <div style={{ color: '#10B981', marginTop: 8, fontWeight: 700 }}>
                  Total: {(result.provenance.totalDurationMs / 1000).toFixed(2)}s | Score: {result.score.toFixed(1)} | Confidence: {result.confidence}
                </div>
              </>
            )}

            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div style={{ marginTop: 12, padding: '10px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: '0.78rem', color: '#DC2626' }}>
          {error}
        </div>
      )}
    </div>
  );
}

// Placeholder step definitions for the "thinking" animation before results arrive
const layerPlaceholders: PipelineStep[] = [
  { name: 'Fetch Reviews', description: 'Resolve hospital identity & scrape Google Maps reviews via Apify', durationMs: 0, inputCount: 0, outputCount: 0, detail: {} },
  { name: 'Deduplication', description: 'Content-hash dedup to remove identical/near-duplicate reviews', durationMs: 0, inputCount: 0, outputCount: 0, detail: {} },
  { name: 'Quality Gate', description: 'Filter spam, empty, and low-confidence reviews', durationMs: 0, inputCount: 0, outputCount: 0, detail: {} },
  { name: 'Classification', description: 'Aspect-based sentiment analysis on each accepted review', durationMs: 0, inputCount: 0, outputCount: 0, detail: {} },
  { name: 'Signal Extraction', description: 'Map classified evidence to scorable signals per dimension', durationMs: 0, inputCount: 0, outputCount: 0, detail: {} },
  { name: 'PII Scoring', description: 'Compute Provider Intelligence Index from weighted signal aggregation', durationMs: 0, inputCount: 0, outputCount: 0, detail: {} },
];

// Render detail chips for each completed step
function renderStepDetail(step: PipelineStep, color: string) {
  const chips: JSX.Element[] = [];
  const d = step.detail;

  if (d.mode) chips.push(<Chip key="mode" color={color} label={`Mode: ${d.mode as string}`} />);
  if (d.algorithm) chips.push(<Chip key="algo" color={color} label={`Algo: ${d.algorithm as string}`} />);
  if (d.duplicatesRemoved !== undefined) chips.push(<Chip key="dups" color="#EF4444" label={`${d.duplicatesRemoved} dupes removed`} />);
  if (d.accepted !== undefined) chips.push(<Chip key="acc" color="#10B981" label={`${d.accepted} accepted`} />);
  if (d.rejected !== undefined) chips.push(<Chip key="rej" color="#EF4444" label={`${d.rejected} rejected`} />);
  if (d.piiScore !== undefined) chips.push(<Chip key="pii" color="#1D4ED8" label={`PII: ${(d.piiScore as number).toFixed(1)}`} />);
  if (d.confidence !== undefined) chips.push(<Chip key="conf" color="#8B5CF6" label={`Conf: ${d.confidence}`} />);

  if (d.aspectDistribution) {
    const aspects = d.aspectDistribution as Record<string, number>;
    Object.entries(aspects).slice(0, 4).forEach(([aspect, count]) => {
      chips.push(<Chip key={aspect} color={color} label={`${aspect}: ${count}`} />);
    });
  }

  if (d.signalTypes) {
    const types = d.signalTypes as string[];
    types.slice(0, 4).forEach((t) => {
      chips.push(<Chip key={t} color={color} label={t} />);
    });
  }

  if (d.rejectionReasons) {
    const reasons = d.rejectionReasons as string[];
    reasons.slice(0, 3).forEach((r, i) => {
      chips.push(<Chip key={`rej-${i}`} color="#F59E0B" label={r} />);
    });
  }

  return chips;
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10,
      background: `${color}10`, color, border: `1px solid ${color}30`,
    }}>
      {label}
    </span>
  );
}
