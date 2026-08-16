import { AppError } from './shared.mjs';
import { validateFacts } from './fact-validator.mjs';

export const MOODS={joy:'радостно, светло и ободряюще, но без преуменьшения серьёзности события',
  sad:'грустно, сдержанно и сочувственно',neutral:'нейтрально, спокойно и информационно',
  ironic:'иронично и тонко, без насмешек над жертвами, пострадавшими или уязвимыми людьми'};
const PROMPT_VERSION='3.0';
const inFlight=new Map();
const SAFE_PREFIXES={joy:'Светлая подача важной новости: ',sad:'С сожалением — ',neutral:'',ironic:'Вот такой поворот: '};

export class RewriteService {
  constructor({newsService,repository,provider,model,maxRetries=2}) { Object.assign(this,{newsService,repository,provider,model,maxRetries}); }
  async rewrite(newsId,mood,{regenerate=false}={}) {
    if(!MOODS[mood]) throw new AppError('Неизвестное настроение',400,'INVALID_MOOD');
    const news=this.newsService.get(newsId);
    if(!regenerate) {
      const cached=this.repository.findCurrent(news.id,mood,news.contentHash,PROMPT_VERSION);
      if(cached) return {...cached,mood,cached:true,factCheck:{status:'passed'}};
    }
    const key=`${news.id}:${mood}`;
    if(inFlight.has(key)) return inFlight.get(key);
    const task=this.generate(news,mood).finally(()=>inFlight.delete(key)); inFlight.set(key,task); return task;
  }
  async generate(news,mood) {
    const sentenceCount=[...new Intl.Segmenter('ru',{granularity:'sentence'}).segment(news.rssSummary)].filter(x=>x.segment.trim()).length;
    const minLength=Math.max(20,Math.floor(news.rssSummary.length*.7)),maxLength=Math.ceil(news.rssSummary.length*1.6);
    let validation,lastText='';
    for(let attempt=0;attempt<=this.maxRetries;attempt++) {
      const correction=validation?.errors.length?`\nПредыдущая версия нарушила ограничения. Начни заново с исходного RSS-анонса. Не объясняй исправления и не цитируй эту инструкцию.`:'';
      lastText=await this.provider.generate({system:`Ты — редактор новостных RSS-анонсов. Перепиши текст ${MOODS[mood]}.
Измени только эмоциональную подачу. Запрещено добавлять факты, предположения, причины или последствия.
Сохрани без изменений имена, организации, места, даты, числа, проценты, валюты, цитаты и отрицания.
Сохрани ровно ${sentenceCount} предложений. Длина результата: от ${minLength} до ${maxLength} символов.
Если в оригинале нет цифр, не используй цифры. Не добавляй новые кавычки или отрицания.
Не добавляй Markdown, заголовок, предисловие, вывод, мораль или пояснения.
Ответ верни как JSON-объект с единственным полем text. В поле text помести только переписанный текст.${correction}`,
        user:`Перепиши этот RSS-анонс:\n${news.rssSummary}`});
      validation=validateFacts(news.rssSummary,lastText);
      if(validation.status==='passed') {
        const semantic=typeof this.provider.verifyFacts==='function'
          ? await this.provider.verifyFacts({source:news.rssSummary,candidate:lastText})
          : {passed:false,reason:'Независимая семантическая проверка недоступна'};
        validation={...validation,semantic};
        if(!semantic.passed) validation={...validation,status:'failed',errors:[...validation.errors,`Семантическая проверка: ${semantic.reason}`]};
      }
      if(validation.status==='passed') {
        const saved=this.repository.save({newsId:news.id,mood,text:lastText,model:this.model,promptVersion:PROMPT_VERSION,
          sourceHash:news.contentHash,factCheck:validation});
        return {...saved,mood,cached:false,factCheck:validation};
      }
    }
    const safeText=SAFE_PREFIXES[mood]+news.rssSummary;
    const safeValidation={...validateFacts(news.rssSummary,safeText),fallback:true,
      note:'Полная AI-версия не прошла проверку; использована безопасная эмоциональная рамка с дословным RSS-анонсом'};
    const saved=this.repository.save({newsId:news.id,mood,text:safeText,model:`${this.model} + safety fallback`,
      promptVersion:PROMPT_VERSION,sourceHash:news.contentHash,factCheck:safeValidation});
    return {...saved,mood,cached:false,fallback:true,factCheck:safeValidation};
  }
}
