import { resolve } from 'node:path';

const integer = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function loadConfig(overrides = {}) {
  const config = {
    port: integer(process.env.PORT, 3000),
    databasePath: resolve(process.env.DATABASE_PATH || './data/tone-news.sqlite'),
    bootstrapPath: resolve(process.env.NEWS_BOOTSTRAP_PATH || './data/bootstrap-news.json'),
    publicPath: resolve('./public'),
    rssSources: (process.env.NEWS_RSS_SOURCES || [
      'Ведомости|https://www.vedomosti.ru/rss/news',
      'РИА Новости|https://ria.ru/export/rss2/archive/index.xml',
      'Коммерсантъ|https://www.kommersant.ru/RSS/news.xml',
      'Google News|https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru'
    ].join(',')).split(',').map(entry => {
      const separator=entry.indexOf('|');
      return {name:separator>0?entry.slice(0,separator).trim():'RSS',url:(separator>0?entry.slice(separator+1):entry).trim()};
    }).filter(source=>source.url),
    syncLimit: integer(process.env.NEWS_SYNC_LIMIT, 30),
    minItems: integer(process.env.NEWS_MIN_ITEMS, 10),
    maxAgeMinutes: integer(process.env.NEWS_MAX_AGE_MINUTES, 30),
    rssRetries: integer(process.env.NEWS_RSS_RETRIES, 2),
    aiProvider: process.env.AI_PROVIDER || 'ollama',
    aiBaseUrl: process.env.AI_BASE_URL || 'http://127.0.0.1:11434',
    aiModel: process.env.AI_MODEL || 'qwen3:4b',
    aiTimeoutMs: integer(process.env.AI_TIMEOUT_MS, 120000),
    aiMaxRetries: integer(process.env.AI_MAX_RETRIES, 3),
    ...overrides
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Некорректный PORT');
  if (!['ollama'].includes(config.aiProvider)) throw new Error(`Неизвестный AI_PROVIDER: ${config.aiProvider}`);
  return config;
}
