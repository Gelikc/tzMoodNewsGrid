import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDatabase(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, rss_summary TEXT NOT NULL, source_name TEXT NOT NULL, original_url TEXT NOT NULL,
      published_at TEXT, fetched_at TEXT NOT NULL, content_hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at DESC);
    CREATE TABLE IF NOT EXISTS rewrites (id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE, mood TEXT NOT NULL, text TEXT NOT NULL,
      model TEXT NOT NULL, prompt_version TEXT NOT NULL, source_hash TEXT NOT NULL, fact_check_status TEXT NOT NULL,
      fact_check_details TEXT, generation INTEGER NOT NULL, created_at TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS idx_rewrite_lookup ON rewrites(news_id,mood,source_hash,is_current);
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  return db;
}

export class NewsRepository {
  constructor(db) { this.db = db; }
  upsertMany(items) {
    const statement = this.db.prepare(`INSERT INTO news
      (external_id,title,rss_summary,source_name,original_url,published_at,fetched_at,content_hash) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET title=excluded.title,rss_summary=excluded.rss_summary,
      source_name=excluded.source_name,original_url=excluded.original_url,published_at=excluded.published_at,
      fetched_at=excluded.fetched_at,content_hash=excluded.content_hash`);
    this.db.exec('BEGIN');
    try { for (const x of items) statement.run(x.externalId,x.title,x.rssSummary,x.sourceName,x.originalUrl,x.publishedAt,x.fetchedAt,x.contentHash); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(limit=30) { return this.db.prepare(`SELECT id,title,rss_summary AS rssSummary,source_name AS sourceName,
    original_url AS originalUrl,published_at AS publishedAt,fetched_at AS fetchedAt FROM news
    ORDER BY COALESCE(published_at,fetched_at) DESC LIMIT ?`).all(limit); }
  find(id) { return this.db.prepare(`SELECT id,title,rss_summary AS rssSummary,source_name AS sourceName,
    original_url AS originalUrl,published_at AS publishedAt,fetched_at AS fetchedAt,content_hash AS contentHash
    FROM news WHERE id=?`).get(id); }
  count() { return this.db.prepare('SELECT COUNT(*) AS count FROM news').get().count; }
  repairAggregatedSummaries(normalize,hash) {
    const rows=this.db.prepare('SELECT id,title,rss_summary AS rssSummary FROM news').all();
    const update=this.db.prepare('UPDATE news SET rss_summary=?,content_hash=? WHERE id=?');let repaired=0;
    for(const row of rows) { const summary=normalize(row.title,row.rssSummary);if(summary!==row.rssSummary){update.run(summary,hash(summary),row.id);repaired++;} }
    return repaired;
  }
  setMeta(key,value) { this.db.prepare('INSERT OR REPLACE INTO app_meta(key,value) VALUES (?,?)').run(key,value); }
  getMeta(key) { return this.db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value ?? null; }
}

export class RewriteRepository {
  constructor(db) { this.db = db; }
  findCurrent(newsId,mood,sourceHash,promptVersion) { return this.db.prepare(`SELECT id,text,model,prompt_version AS promptVersion,
    generation,created_at AS createdAt FROM rewrites WHERE news_id=? AND mood=? AND source_hash=? AND prompt_version=? AND is_current=1
    ORDER BY id DESC LIMIT 1`).get(newsId,mood,sourceHash,promptVersion); }
  save(x) {
    const generation=this.db.prepare('SELECT COALESCE(MAX(generation),0)+1 AS value FROM rewrites WHERE news_id=? AND mood=?').get(x.newsId,x.mood).value;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE rewrites SET is_current=0 WHERE news_id=? AND mood=?').run(x.newsId,x.mood);
      const result=this.db.prepare(`INSERT INTO rewrites (news_id,mood,text,model,prompt_version,source_hash,
        fact_check_status,fact_check_details,generation,created_at,is_current) VALUES (?,?,?,?,?,?,?,?,?,?,1)`)
        .run(x.newsId,x.mood,x.text,x.model,x.promptVersion,x.sourceHash,x.factCheck.status,JSON.stringify(x.factCheck),generation,new Date().toISOString());
      this.db.exec('COMMIT'); return this.findById(result.lastInsertRowid);
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  findById(id) { return this.db.prepare(`SELECT id,text,model,prompt_version AS promptVersion,generation,
    created_at AS createdAt FROM rewrites WHERE id=?`).get(id); }
}
