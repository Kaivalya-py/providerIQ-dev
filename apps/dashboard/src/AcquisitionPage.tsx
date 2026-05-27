import { useState } from 'react';
import { Search, Activity, RefreshCw, CheckCircle2, AlertCircle, BarChart2, Shield, Heart, TrendingUp, Building2 } from 'lucide-react';

const API = import.meta.env.PROD ? '/api/trpc' : 'http://localhost:4000/trpc';

interface AcquisitionResult {
  runId: string;
  hospitalName: string;
  city: string;
  collected: number;
  accepted: number;
  rejected: number;
  duplicatesRemoved: number;
  signalCount: number;
  score: number;
  dimensions: Record<string, { score: number; weight: number; confidence: number; signalCount: number; topSignals: string[]; status: string }>;
  positiveFactors: { label: string; description: string; impact: string; magnitude: string; source: string }[];
  negativeFactors: { label: string; description: string; impact: string; magnitude: string; source: string }[];
  confidence: number;
  narrative: string;
  sampleReviews: { text: string; rating: number; publishedAt: string; sentiment: string; aspects: string[] }[];
}

export default function AcquisitionPage() {
  const [hospitalName, setHospitalName] = useState('');
  const [city, setCity] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [maxReviews, setMaxReviews] = useState(100);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<AcquisitionResult | null>(null);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const runAcquisition = async () => {
    if (!hospitalName.trim() || !city.trim()) return;
    setStatus('running');
    setError('');
    setResult(null);
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try {
      const body = {
        hospitalName: hospitalName.trim(),
        city: city.trim(),
        ...(googleMapsUrl.trim() ? { googleMapsUrl: googleMapsUrl.trim() } : {}),
        maxReviews,
      };

      const res = await fetch(`${API}/runAcquisition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      clearInterval(timer);
      setElapsed(Math.floor((Date.now() - start) / 1000));

      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      setResult(data.result?.data ?? data);
      setStatus('done');
    } catch (e: any) {
      clearInterval(timer);
      setElapsed(Math.floor((Date.now() - start) / 1000));
      setError(e.message || 'Unknown error');
      setStatus('error');
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#10B981';
    if (score >= 60) return '#F59E0B';
    return '#EF4444';
  };

  const getSentimentColor = (s: string) => {
    if (s === 'positive') return '#10B981';
    if (s === 'negative') return '#EF4444';
    return '#94A3B8';
  };

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflow: 'auto', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity color="var(--blue)" /> Acquisition Pipeline
        </h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Enter a hospital name and city to fetch real Google Maps reviews, classify them, and compute a public credit score.
        </p>
      </div>

      {/* Input Form */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 24, padding: 20, background: '#fff', borderRadius: 12, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Hospital Name *</label>
          <input
            type="text"
            value={hospitalName}
            onChange={(e) => setHospitalName(e.target.value)}
            placeholder="e.g. Manipal Hospital Whitefield"
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.85rem', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 160px' }}>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>City *</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Bengaluru"
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.85rem', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px' }}>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Google Maps URL (optional)</label>
          <input
            type="text"
            value={googleMapsUrl}
            onChange={(e) => setGoogleMapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/... or leave blank for auto-discovery"
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.85rem', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 100px' }}>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Max Reviews</label>
          <input
            type="number"
            value={maxReviews}
            onChange={(e) => setMaxReviews(Number(e.target.value) || 100)}
            min={1}
            max={500}
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.85rem', outline: 'none' }}
          />
        </div>
        <button
          onClick={runAcquisition}
          disabled={status === 'running' || !hospitalName.trim() || !city.trim()}
          style={{
            height: 42, padding: '0 24px', borderRadius: 8, border: 'none',
            background: status === 'running' ? '#94A3B8' : 'var(--blue)', color: '#fff',
            fontWeight: 700, fontSize: '0.85rem', cursor: status === 'running' ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
          }}
        >
          {status === 'running' ? <RefreshCw size={14} className="spinning" /> : <Search size={14} />}
          {status === 'running' ? `Running (${elapsed}s)...` : 'Run Acquisition'}
        </button>
      </div>

      {/* Error */}
      {status === 'error' && (
        <div style={{ padding: 16, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={18} color="#EF4444" />
          <span style={{ fontSize: '0.85rem', color: '#991B1B' }}>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Score Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, padding: 24, background: '#fff', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: '3.5rem', fontWeight: 900, color: getScoreColor(result.score), lineHeight: 1 }}>{result.score}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 700, marginTop: 4 }}>PII SCORE</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2 }}>Confidence: {Math.round(result.confidence * 100)}%</div>
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 4 }}>{result.hospitalName}, {result.city}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>{result.narrative}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                <Stat label="Reviews Collected" value={result.collected} />
                <Stat label="Accepted" value={result.accepted} />
                <Stat label="Rejected" value={result.rejected} />
                <Stat label="Duplicates" value={result.duplicatesRemoved} />
                <Stat label="Signals Generated" value={result.signalCount} />
                <Stat label="Run Time" value={`${elapsed}s`} />
              </div>
            </div>
          </div>

          {/* Dimensions */}
          <div style={{ padding: 24, background: '#fff', borderRadius: 12, border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 16 }}>Score Dimensions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {Object.entries(result.dimensions).map(([key, dim]) => (
                <div key={key} style={{ padding: 14, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: getScoreColor(dim.score) }}>{dim.score}</span>
                  </div>
                  <div style={{ width: '100%', height: 6, background: '#E2E8F0', borderRadius: 3 }}>
                    <div style={{ width: `${dim.score}%`, height: '100%', background: getScoreColor(dim.score), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {dim.signalCount} signals | {dim.status} | weight: {dim.weight}
                  </div>
                  {dim.topSignals.length > 0 && (
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      {dim.topSignals.slice(0, 2).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Sample Reviews */}
          <div style={{ padding: 24, background: '#fff', borderRadius: 12, border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 16 }}>Sample Reviews (Top 10)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {result.sampleReviews.map((r, i) => (
                <div key={i} style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{'★'.repeat(r.rating || 0)}{'☆'.repeat(5 - (r.rating || 0))}</span>
                      <span style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: getSentimentColor(r.sentiment) + '20', color: getSentimentColor(r.sentiment) }}>
                        {r.sentiment}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>
                      {r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {r.text || <em style={{ color: 'var(--text-tertiary)' }}>No text (rating only)</em>}
                  </div>
                  {r.aspects.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                      {r.aspects.map((a, ai) => (
                        <span key={ai} style={{ fontSize: '0.55rem', padding: '2px 6px', borderRadius: 4, background: '#EFF6FF', color: '#1D4ED8', fontWeight: 600 }}>
                          {a.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Factors */}
          {(result.positiveFactors.length > 0 || result.negativeFactors.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ padding: 20, background: '#ECFDF5', borderRadius: 12, border: '1px solid #A7F3D0' }}>
                <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#065F46', marginBottom: 10 }}>Positive Factors</h3>
                {result.positiveFactors.map((f, i) => (
                  <div key={i} style={{ marginBottom: 8, fontSize: '0.75rem', color: '#065F46' }}>
                    <strong>{f.label}:</strong> {f.description}
                  </div>
                ))}
                {result.positiveFactors.length === 0 && <div style={{ fontSize: '0.75rem', color: '#6EE7B7' }}>None identified</div>}
              </div>
              <div style={{ padding: 20, background: '#FEF2F2', borderRadius: 12, border: '1px solid #FECACA' }}>
                <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#991B1B', marginBottom: 10 }}>Risk Factors</h3>
                {result.negativeFactors.map((f, i) => (
                  <div key={i} style={{ marginBottom: 8, fontSize: '0.75rem', color: '#991B1B' }}>
                    <strong>{f.label}:</strong> {f.description}
                  </div>
                ))}
                {result.negativeFactors.length === 0 && <div style={{ fontSize: '0.75rem', color: '#FCA5A5' }}>None identified</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Running state */}
      {status === 'running' && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw size={32} className="spinning" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Running acquisition pipeline...</div>
          <div style={{ fontSize: '0.75rem', marginTop: 4 }}>Fetching reviews from Google Maps via Apify, classifying, and scoring.</div>
          <div style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--text-tertiary)' }}>Elapsed: {elapsed}s (typically 30-120s)</div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>{label}</div>
    </div>
  );
}
