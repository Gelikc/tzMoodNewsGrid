import { AppError } from './shared.mjs';
export class NewsService {
  constructor({repository,provider,minItems=10,maxAgeMinutes=30,bootstrapItems=[]}) { Object.assign(this,{repository,provider,minItems,maxAgeMinutes,bootstrapItems}); }
  seedBootstrap() {
    if(this.repository.count()>=this.minItems||this.bootstrapItems.length<this.minItems) return false;
    this.repository.upsertMany(this.bootstrapItems);
    this.repository.setMeta('bootstrap_loaded_at',new Date().toISOString());
    return true;
  }
  async sync() {
    const items=await this.provider.fetchNews();
    if(items.length<this.minItems) throw new AppError(`Источник вернул только ${items.length} новостей; требуется минимум ${this.minItems}`,502,'NOT_ENOUGH_NEWS');
    this.repository.upsertMany(items); const now=new Date().toISOString();
    this.repository.setMeta('last_sync_at',now); this.repository.setMeta('last_sync_error',''); return {count:items.length,lastUpdatedAt:now};
  }
  async list({forceSync=false}={}) {
    const lastSync=this.repository.getMeta('last_sync_at');
    const expired=!lastSync||Date.now()-Date.parse(lastSync)>this.maxAgeMinutes*60000; let warning=null;
    if(forceSync||expired||this.repository.count()<this.minItems) try { await this.sync(); }
    catch(error) { warning=error.message; this.repository.setMeta('last_sync_error',error.message); this.seedBootstrap();
      if(this.repository.count()<this.minItems) throw new AppError(`Не удалось получить минимум ${this.minItems} реальных новостей: ${error.message}`,503,'NEWS_UNAVAILABLE'); }
    const updatedAt=this.repository.getMeta('last_sync_at');
    const bootstrapped=Boolean(this.repository.getMeta('bootstrap_loaded_at'))&&!updatedAt;
    return {items:this.repository.list(),meta:{source:'Открытые RSS-ленты',count:this.repository.count(),lastUpdatedAt:updatedAt,
      isStale:Boolean(warning)||bootstrapped,warning:warning||(bootstrapped?'RSS временно недоступны; показан проверяемый снимок реальных публикаций с оригинальными ссылками.':null)}};
  }
  get(id) { const item=this.repository.find(id); if(!item) throw new AppError('Новость не найдена',404,'NEWS_NOT_FOUND'); return item; }
}
