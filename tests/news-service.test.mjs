import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase,NewsRepository } from '../src/database.mjs';
import { NewsService } from '../src/news-service.mjs';
import { hash } from '../src/shared.mjs';

test('при недоступном RSS заполняет пустую базу снимком реальных публикаций',async()=>{
  const db=createDatabase(':memory:'),repository=new NewsRepository(db),now=new Date().toISOString();
  const bootstrapItems=Array.from({length:10},(_,index)=>({externalId:`real-${index}`,title:`Публикация ${index}`,rssSummary:`Фактический анонс ${index}`,sourceName:'Открытый источник',originalUrl:`https://example.com/news/${index}`,publishedAt:now,fetchedAt:now,contentHash:hash(`Фактический анонс ${index}`)}));
  const service=new NewsService({repository,provider:{fetchNews:async()=>{throw new Error('RSS offline')}},minItems:10,bootstrapItems});
  const result=await service.list();
  assert.equal(result.items.length,10);assert.equal(result.meta.isStale,true);assert.match(result.meta.warning,/RSS offline/);db.close();
});
