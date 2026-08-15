import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = join(process.cwd(), 'public');
const FEED = 'https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru';

const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decodeEntities = (s = '') => s.replace(/&(#x?[\da-f]+|\w+);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(e[1] === 'x' ? 2 : 1), e[1] === 'x' ? 16 : 10));
    return entities[e] ?? `&${e};`;
  });
const decode = (s = '') => {
  let clean = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // RSS may contain HTML encoded once or twice. Decode it before removing tags.
  clean = decodeEntities(decodeEntities(clean));
  return clean
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);

async function getNews() {
  const response = await fetch(FEED, { headers: { 'user-agent': 'ToneNews/1.0' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`RSS: ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 18).map(([, item], i) => {
    const rawTitle = tag(item, 'title');
    const source = tag(item, 'source') || rawTitle.split(' - ').at(-1) || 'Источник';
    const title = rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -source.length - 3) : rawTitle;
    return {
      id: i + 1,
      title,
      summary: tag(item, 'description') || title,
      source,
      url: tag(item, 'link'),
      publishedAt: tag(item, 'pubDate')
    };
  });
}

function rewrite({ title, text, mood }) {
  const templates = {
    joy: ['И вот что важно: ', 'Ещё одна деталь: ', 'А теперь — к хорошему: '],
    sad: ['Сдержанно о главном: ', 'К сожалению, ', 'Важная деталь: '],
    neutral: ['', '', ''],
    ironic: ['Что ж, ', 'Между тем, ', 'И вот ещё один штрих: ']
  };
  if (!templates[mood]) throw Object.assign(new Error('Неизвестная эмоция'), { status: 400 });

  const segmenter = new Intl.Segmenter('ru', { granularity: 'sentence' });
  const sentences = [...segmenter.segment(text.trim())].map(({ segment }) => segment.trim()).filter(Boolean);
  const seed = [...title].reduce((sum, char) => sum + char.codePointAt(0), 0);

  // Сами предложения остаются буквально неизменными: шаблон добавляет только тональные связки.
  return sentences.map((sentence, index) => {
    const prefix = templates[mood][(seed + index) % templates[mood].length];
    const adjusted = prefix && /^[А-ЯЁ]/.test(sentence)
      ? sentence[0].toLocaleLowerCase('ru') + sentence.slice(1)
      : sentence;
    return prefix + adjusted;
  }).join(' ');
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/news') return json(res, 200, { items: await getNews(), rewriteMode: 'templates' });
    if (url.pathname === '/api/rewrite' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw Object.assign(new Error('Текст слишком длинный'), { status: 413 }); }
      const body = JSON.parse(raw);
      if (!body.title || !body.text) throw Object.assign(new Error('Нет текста новости'), { status: 400 });
      return json(res, 200, { text: rewrite(body), mode: 'templates' });
    }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = await readFile(join(PUBLIC, path));
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(file);
  } catch (error) {
    if (req.url?.startsWith('/api/')) return json(res, error.status || 500, { error: error.message });
    try { const file = await readFile(join(PUBLIC, 'index.html')); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(file); }
    catch { res.writeHead(404); res.end('Not found'); }
  }
}).listen(PORT, () => console.log(`ToneNews: http://localhost:${PORT}`));
