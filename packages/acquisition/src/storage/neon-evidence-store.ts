import pg from 'pg';
import type { RawEvidence } from '../types/raw-evidence.types.js';

const { Pool } = pg;

export interface NeonEvidenceStoreConfig {
  connectionString: string;
}

export class NeonEvidenceStore {
  private pool: pg.Pool;

  constructor(config: NeonEvidenceStoreConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }

  /** Create the raw_evidence table if it doesn't exist */
  async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS raw_evidence (
        id                    TEXT PRIMARY KEY,
        hospital_seed_id      TEXT NOT NULL,
        source                TEXT NOT NULL,
        source_type           TEXT NOT NULL,
        source_url            TEXT,
        canonical_source_url  TEXT,
        source_record_id      TEXT NOT NULL,
        collected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at          TIMESTAMPTZ,
        title                 TEXT,
        text                  TEXT,
        rating                REAL,
        rating_scale          REAL,
        author_display_name_hash TEXT,
        public_author_metadata JSONB,
        platform_metadata     JSONB,
        hospital_match        JSONB,
        acquisition           JSONB,
        raw_quality_flags     TEXT[] DEFAULT '{}',
        pii_flags             JSONB DEFAULT '{}',
        processing_status     TEXT NOT NULL DEFAULT 'raw_collected',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_evidence_dedup
        ON raw_evidence (source, source_record_id);

      CREATE INDEX IF NOT EXISTS idx_raw_evidence_hospital
        ON raw_evidence (hospital_seed_id);

      CREATE INDEX IF NOT EXISTS idx_raw_evidence_source
        ON raw_evidence (source, hospital_seed_id);

      CREATE INDEX IF NOT EXISTS idx_raw_evidence_collected
        ON raw_evidence (collected_at DESC);
    `);
  }

  /**
   * Upsert a batch of RawEvidence records.
   * Delta logic: skip if source + source_record_id already exists (no overwrite).
   * Returns count of newly inserted records.
   */
  async upsertBatch(records: RawEvidence[]): Promise<{ inserted: number; skipped: number }> {
    if (records.length === 0) return { inserted: 0, skipped: 0 };

    let inserted = 0;
    let skipped = 0;

    // Process in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const result = await this.upsertChunk(chunk);
      inserted += result.inserted;
      skipped += result.skipped;
    }

    return { inserted, skipped };
  }

  private async upsertChunk(records: RawEvidence[]): Promise<{ inserted: number; skipped: number }> {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const r of records) {
      placeholders.push(`(
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++},
        $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}
      )`);

      values.push(
        r.id,
        r.hospitalSeedId,
        r.source,
        r.sourceType,
        r.sourceUrl ?? null,
        r.canonicalSourceUrl ?? null,
        r.sourceRecordId,
        r.collectedAt,
        r.publishedAt ?? null,
        r.title ?? null,
        r.text ?? null,
        r.rating ?? null,
        r.ratingScale ?? null,
        r.authorDisplayNameHash ?? null,
        JSON.stringify(r.publicAuthorMetadata ?? null),
        JSON.stringify(r.platformMetadata ?? null),
        JSON.stringify(r.hospitalMatch ?? null),
        JSON.stringify(r.acquisition ?? null),
        r.rawQualityFlags ?? [],
        JSON.stringify(r.piiFlags ?? {}),
        r.processingStatus,
      );
    }

    const query = `
      INSERT INTO raw_evidence (
        id, hospital_seed_id, source, source_type,
        source_url, canonical_source_url, source_record_id, collected_at,
        published_at, title, text, rating,
        rating_scale, author_display_name_hash, public_author_metadata, platform_metadata,
        hospital_match, acquisition, raw_quality_flags, pii_flags, processing_status
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (source, source_record_id) DO NOTHING
    `;

    const result = await this.pool.query(query, values);
    const insertedCount = result.rowCount ?? 0;
    return { inserted: insertedCount, skipped: records.length - insertedCount };
  }

  /** Get count of existing records for a hospital+source combo */
  async getCount(hospitalSeedId: string, source?: string): Promise<number> {
    const query = source
      ? `SELECT COUNT(*) as cnt FROM raw_evidence WHERE hospital_seed_id = $1 AND source = $2`
      : `SELECT COUNT(*) as cnt FROM raw_evidence WHERE hospital_seed_id = $1`;
    const params = source ? [hospitalSeedId, source] : [hospitalSeedId];
    const result = await this.pool.query(query, params);
    return parseInt(result.rows[0]?.cnt ?? '0', 10);
  }

  /** Check if we already have records for a given source_record_id */
  async exists(source: string, sourceRecordId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM raw_evidence WHERE source = $1 AND source_record_id = $2 LIMIT 1`,
      [source, sourceRecordId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}
