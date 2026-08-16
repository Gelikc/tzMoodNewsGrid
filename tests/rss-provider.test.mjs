import test from 'node:test';
import assert from 'node:assert/strict';
import { RssProvider,MultiRssProvider,normalizeRssSummary } from '../src/rss-provider.mjs';

const item=i=>`<item><guid>id-${i}</guid><title>Новость ${i} - Источник</title><link>https://example.com/${i}</link><source>Источник</source><description><![CDATA[Анонс новости ${i}]]></description><pubDate>Fri, 15 Aug 2025 10:00:00 GMT</pubDate></item>`;
test('парсит минимум 10 реальных RSS-записей в структурированный формат',()=>{
  const provider=new RssProvider({url:'test',sourceName:'Источник',limit:30}); const result=provider.parse(`<rss><channel>${Array.from({length:12},(_,i)=>item(i)).join('')}</channel></rss>`);
  assert.equal(result.length,12); assert.equal(result[0].title,'Новость 0'); assert.match(result[0].originalUrl,/example\.com/); assert.ok(result[0].contentHash);
});
test('удаляет дубликаты по guid',()=>{
  const provider=new RssProvider({url:'test'}); assert.equal(provider.parse(`<rss>${item(1)}${item(1)}</rss>`).length,1);
});
test('использует доступные источники, если один RSS не отвечает',async()=>{
  const good=new RssProvider({url:'test',sourceName:'Источник',fetchImpl:async()=>({ok:true,text:async()=>`<rss>${item(1)}</rss>`})});
  const bad={fetchNews:async()=>{throw new Error('timeout')}};
  const result=await new MultiRssProvider([bad,good]).fetchNews();assert.equal(result.length,1);
});
test('заменяет агрегированную подборку Google на исходный заголовок',()=>{
  const title='Телефон стал неудобным спустя 10 месяцев';
  const summary=`${title} mobile-review.com 51% выбрали другой телефон BFМ.ru Новая статья CNews.ru`;
  assert.equal(normalizeRssSummary(title,summary),title);
});
test('повторяет временно неудачный RSS-запрос и сообщает имя источника',async()=>{
  let calls=0;const provider=new RssProvider({url:'https://example.com/rss',sourceName:'Тестовый RSS',retries:1,fetchImpl:async()=>{calls++;if(calls===1)throw new Error('temporary');return {ok:true,text:async()=>`<rss>${item(1)}</rss>`}}});
  assert.equal((await provider.fetchNews()).length,1);assert.equal(calls,2);
  const failed=new RssProvider({url:'https://example.com/bad',sourceName:'Плохой RSS',retries:0,fetchImpl:async()=>{throw new Error('network down')}});
  await assert.rejects(failed.fetchNews(),/Плохой RSS.*network down/);
});
