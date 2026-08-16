import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { loadConfig } from './config.mjs';
import { createDatabase,NewsRepository,RewriteRepository } from './database.mjs';
import { RssProvider,MultiRssProvider,normalizeRssSummary } from './rss-provider.mjs';
import { NewsService } from './news-service.mjs';
import { OllamaProvider } from './ollama-provider.mjs';
import { RewriteService } from './rewrite-service.mjs';
import { AppError } from './shared.mjs';
import { hash } from './shared.mjs';

const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
async function body(req) { let raw=''; for await(const chunk of req) { raw+=chunk; if(raw.length>10000) throw new AppError('Запрос слишком большой',413,'BODY_TOO_LARGE'); }
  if(!raw) return {}; try{return JSON.parse(raw);}catch{throw new AppError('Некорректный JSON',400,'INVALID_JSON');} }
const numeric=value=>{if(!/^\d+$/.test(value)) throw new AppError('Некорректный ID',400,'INVALID_ID');return Number(value);};

export function createApplication(overrides={}) {
  const config=loadConfig(overrides.config); const db=overrides.db||createDatabase(config.databasePath);
  const newsRepository=new NewsRepository(db),rewriteRepository=new RewriteRepository(db);
  newsRepository.repairAggregatedSummaries(normalizeRssSummary,hash);
  const rssProvider=overrides.rssProvider||new MultiRssProvider(config.rssSources.map(source=>new RssProvider({
    url:source.url,sourceName:source.name,limit:config.syncLimit,timeoutMs:12000,retries:config.rssRetries
  })),{limit:config.syncLimit});
  let bootstrapItems=[];
  try { bootstrapItems=JSON.parse(readFileSync(config.bootstrapPath,'utf8')).map(item=>({...item,fetchedAt:item.fetchedAt||new Date().toISOString(),contentHash:hash(item.rssSummary)})); } catch {}
  const newsService=new NewsService({repository:newsRepository,provider:rssProvider,minItems:config.minItems,maxAgeMinutes:config.maxAgeMinutes,bootstrapItems});
  const aiProvider=overrides.aiProvider||new OllamaProvider({baseUrl:config.aiBaseUrl,model:config.aiModel,timeoutMs:config.aiTimeoutMs});
  const rewriteService=new RewriteService({newsService,repository:rewriteRepository,provider:aiProvider,model:config.aiModel,maxRetries:config.aiMaxRetries});

  const handler=async(req,res)=>{
    try {
      const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),parts=url.pathname.split('/').filter(Boolean);
      if(req.method==='GET'&&url.pathname==='/api/news') return json(res,200,await newsService.list());
      if(req.method==='POST'&&url.pathname==='/api/news/sync') return json(res,200,{...(await newsService.sync()),...(await newsService.list())});
      if(req.method==='GET'&&parts[0]==='api'&&parts[1]==='news'&&parts.length===3) return json(res,200,newsService.get(numeric(parts[2])));
      if(req.method==='POST'&&parts[0]==='api'&&parts[1]==='news'&&parts[3]==='rewrite') {
        const payload=await body(req),regenerate=parts[4]==='regenerate';
        if(parts.length!==(regenerate?5:4)) throw new AppError('Маршрут не найден',404,'NOT_FOUND');
        return json(res,200,await rewriteService.rewrite(numeric(parts[2]),payload.mood,{regenerate}));
      }
      if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{status:'ok',database:'ok',newsCount:newsRepository.count(),
        ai:{provider:config.aiProvider,model:config.aiModel,available:await aiProvider.health()}});
      if(url.pathname.startsWith('/api/')) throw new AppError('Маршрут не найден',404,'NOT_FOUND');
      const requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      const filePath=resolve(config.publicPath,requested);
      if(filePath!==config.publicPath&&!filePath.startsWith(config.publicPath+sep)) throw new AppError('Недопустимый путь',403,'FORBIDDEN');
      const file=await readFile(filePath),types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
      res.writeHead(200,{'content-type':types[extname(filePath)]||'application/octet-stream','cache-control':'no-store'});res.end(file);
    } catch(error) {
      if(req.url?.startsWith('/api/')) return json(res,error.status||500,{error:error.message,code:error.code||'INTERNAL_ERROR',details:error.details});
      res.writeHead(error.code==='ENOENT'?404:error.status||500);res.end('Not found');
    }
  };
  return {handler,db,services:{newsService,rewriteService},config};
}

export function startServer(overrides={}) {
  const app=createApplication(overrides),server=createServer(app.handler);
  server.listen(app.config.port,()=>console.log(`ToneNews: http://localhost:${app.config.port}`));
  server.on('error',error=>{ if(error.code==='EADDRINUSE') console.error(`Порт ${app.config.port} уже занят. Остановите прежний процесс или задайте другой PORT.`); else console.error(error); app.db.close();process.exitCode=1; });
  const close=()=>server.close(()=>{app.db.close();process.exit(0);}); process.once('SIGINT',close);process.once('SIGTERM',close);
  return {server,...app};
}
