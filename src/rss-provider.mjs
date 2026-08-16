import { cleanText, hash } from './shared.mjs';
const tag=(xml,name)=>cleanText(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]||'');

export function normalizeRssSummary(title,summary) {
  const domains=summary.match(/(?:[a-zа-я0-9-]+\.)+(?:ru|com|net|org|рф)\b/giu)||[];
  const looksAggregated=summary.length>title.length*2.5&&new Set(domains.map(x=>x.toLowerCase())).size>=2;
  return looksAggregated?title:summary;
}

export class RssProvider {
  constructor({url,sourceName='RSS',limit=30,timeoutMs=10000,retries=2,fetchImpl=fetch}) { Object.assign(this,{url,sourceName,limit,timeoutMs,retries,fetchImpl}); }
  async fetchNews() {
    let lastError;
    for(let attempt=0;attempt<=this.retries;attempt++) try {
      const response=await this.fetchImpl(this.url,{headers:{'user-agent':'ToneNews/3.0','accept':'application/rss+xml, application/xml, text/xml'},signal:AbortSignal.timeout(this.timeoutMs)});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const items=this.parse(await response.text());
      if(!items.length) throw new Error('лента не содержит подходящих записей');
      return items;
    } catch(error) { lastError=error; }
    throw new Error(`${this.sourceName} (${this.url}): ${lastError?.cause?.message||lastError?.message||'неизвестная ошибка'}`);
  }
  parse(xml) {
    const fetchedAt=new Date().toISOString(),seen=new Set(),items=[];
    for(const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
      const raw=match[1],rawTitle=tag(raw,'title'),taggedSource=tag(raw,'source');
      const sourceName=taggedSource||this.sourceName;
      const title=taggedSource&&rawTitle.endsWith(` - ${sourceName}`)?rawTitle.slice(0,-sourceName.length-3):rawTitle;
      const originalUrl=tag(raw,'link'),rssSummary=normalizeRssSummary(title,tag(raw,'description')||title);
      if(!title||!originalUrl||!rssSummary) continue;
      const externalId=`${sourceName}:${tag(raw,'guid')||originalUrl||hash(`${title}|${sourceName}`)}`;
      if(seen.has(externalId)) continue; seen.add(externalId);
      const date=tag(raw,'pubDate'),parsedDate=Date.parse(date);
      items.push({externalId,title,rssSummary,sourceName,originalUrl,publishedAt:Number.isFinite(parsedDate)?new Date(parsedDate).toISOString():null,
        fetchedAt,contentHash:hash(rssSummary)});
      if(items.length>=this.limit) break;
    }
    return items;
  }
}

export class MultiRssProvider {
  constructor(providers,{limit=30}={}) { this.providers=providers;this.limit=limit; }
  async fetchNews() {
    const results=await Promise.allSettled(this.providers.map(provider=>provider.fetchNews()));
    const items=results.flatMap(result=>result.status==='fulfilled'?result.value:[]),seen=new Set(),unique=[];
    for(const item of items.sort((a,b)=>Date.parse(b.publishedAt||b.fetchedAt)-Date.parse(a.publishedAt||a.fetchedAt))) {
      const key=item.originalUrl||item.externalId;if(seen.has(key))continue;seen.add(key);unique.push(item);if(unique.length>=this.limit)break;
    }
    if(!unique.length) {
      const messages=results.filter(result=>result.status==='rejected').map(result=>result.reason?.message).filter(Boolean);
      throw new Error(`Все RSS-источники недоступны${messages.length?`: ${messages.join('; ')}`:''}`);
    }
    return unique;
  }
}
