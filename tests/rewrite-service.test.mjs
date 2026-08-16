import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase,NewsRepository,RewriteRepository } from '../src/database.mjs';
import { NewsService } from '../src/news-service.mjs';
import { RewriteService } from '../src/rewrite-service.mjs';
import { hash } from '../src/shared.mjs';

function setup(){
  const db=createDatabase(':memory:'),newsRepo=new NewsRepository(db),text='Компания не открыла 2 офиса.';
  newsRepo.upsertMany([{externalId:'one',title:'Заголовок',rssSummary:text,sourceName:'Источник',originalUrl:'https://example.com',publishedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),contentHash:hash(text)}]);
  const newsService=new NewsService({repository:newsRepo,provider:{fetchNews:async()=>[]}});let calls=0;
  const provider={generate:async()=>{calls++;return 'К сожалению, компания не открыла 2 офиса.'},verifyFacts:async()=>({passed:true,reason:'Смысл сохранён'})};
  const service=new RewriteService({newsService,repository:new RewriteRepository(db),provider,model:'qwen3:4b',maxRetries:0});
  return {db,service,get calls(){return calls}};
}
test('первый запрос генерирует, второй использует кэш',async()=>{
  const ctx=setup();const first=await ctx.service.rewrite(1,'sad'),second=await ctx.service.rewrite(1,'sad');
  assert.equal(first.cached,false);assert.equal(second.cached,true);assert.equal(ctx.calls,1);ctx.db.close();
});
test('перегенерация обходит кэш и создаёт новую версию',async()=>{
  const ctx=setup();await ctx.service.rewrite(1,'sad');const second=await ctx.service.rewrite(1,'sad',{regenerate:true});
  assert.equal(second.generation,2);assert.equal(ctx.calls,2);ctx.db.close();
});
test('использует безопасную рамку, если AI меняет факты',async()=>{
  const db=createDatabase(':memory:'),newsRepo=new NewsRepository(db),text='Два судна получили повреждения.';
  newsRepo.upsertMany([{externalId:'unsafe',title:'Заголовок',rssSummary:text,sourceName:'Источник',originalUrl:'https://example.com',publishedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),contentHash:hash(text)}]);
  const newsService=new NewsService({repository:newsRepo,provider:{fetchNews:async()=>[]}});
  const service=new RewriteService({newsService,repository:new RewriteRepository(db),provider:{generate:async()=>'Пять судов не получили повреждения.'},model:'qwen3:4b',maxRetries:1});
  const result=await service.rewrite(1,'ironic');
  assert.equal(result.fallback,true);assert.match(result.text,/^Вот такой поворот:/);assert.match(result.text,/Два судна получили повреждения/);db.close();
});
test('использует безопасную рамку, если семантическая проверка находит перестановку ролей',async()=>{
  const db=createDatabase(':memory:'),newsRepo=new NewsRepository(db),text='Петр Ян проведет матч-реванш против грузина Мераба Двалишвили.';
  newsRepo.upsertMany([{externalId:'roles',title:'Заголовок',rssSummary:text,sourceName:'Источник',originalUrl:'https://example.com',publishedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),contentHash:hash(text)}]);
  const newsService=new NewsService({repository:newsRepo,provider:{fetchNews:async()=>[]}});
  const provider={generate:async()=>'Россияне Петр Ян и Мераба Двалишвили проведут матч-реванш.',verifyFacts:async()=>({passed:false,reason:'Изменено гражданство и роли'})};
  const service=new RewriteService({newsService,repository:new RewriteRepository(db),provider,model:'qwen3:4b',maxRetries:0});
  const result=await service.rewrite(1,'ironic');
  assert.equal(result.fallback,true);assert.match(result.text,/Петр Ян проведет матч-реванш/);db.close();
});
