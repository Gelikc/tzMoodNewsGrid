import { AppError } from './shared.mjs';

export class OllamaProvider {
  constructor({baseUrl,model,timeoutMs=120000,fetchImpl=fetch}) { Object.assign(this,{baseUrl:baseUrl.replace(/\/$/,''),model,timeoutMs,fetchImpl}); }
  async generate({system,user}) {
    const payload=await this.request({system,user,format:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}});
    let content=payload.message?.content?.trim()||'';
    content=content.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/^```(?:json|text)?\s*/i,'').replace(/\s*```$/,'').trim();
    let text='';
    try { const parsed=JSON.parse(content);text=typeof parsed.text==='string'?parsed.text.trim():''; } catch { text=content; }
    text=text.replace(/^(?:переписанный текст|результат|ответ)\s*:\s*/i,'').trim();
    if(!text) throw new AppError('Ollama вернул пустой ответ',502,'AI_EMPTY_RESPONSE');
    return text;
  }
  async verifyFacts({source,candidate}) {
    const payload=await this.request({
      system:`Ты независимый строгий фактчекер. Сравни исходный RSS-анонс и переписанный текст. Проверяй имена, гражданство, роли, организации, места, даты, числа, цитаты, отрицания, субъект и объект действия, причинно-следственные связи. Любое новое утверждение, перестановка ролей или изменение смысла означает passed=false. Эмоциональные вводные допустимы, только если не содержат новых фактов. Ответь только JSON.`,
      user:`ИСХОДНИК:\n${source}\n\nВЕРСИЯ:\n${candidate}`,
      format:{type:'object',properties:{passed:{type:'boolean'},reason:{type:'string'}},required:['passed','reason'],additionalProperties:false}
    });
    let content=payload.message?.content?.trim()||'';
    content=content.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    try { const result=JSON.parse(content); if(typeof result.passed==='boolean') return {passed:result.passed,reason:String(result.reason||'')}; } catch {}
    return {passed:false,reason:'Проверяющая модель вернула некорректный ответ'};
  }
  async request({system,user,format}) {
    let response;
    try {
      response=await this.fetchImpl(`${this.baseUrl}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},
        signal:AbortSignal.timeout(this.timeoutMs),body:JSON.stringify({model:this.model,stream:false,think:false,
        format,
          messages:[{role:'system',content:system},{role:'user',content:user}],options:{temperature:0.2,top_p:0.8,num_ctx:4096,num_predict:300}})});
    } catch(error) {
      throw new AppError(`Ollama недоступен. Запустите «ollama serve» и установите модель «${this.model}»`,503,'AI_UNAVAILABLE',{cause:error.message});
    }
    let payload={}; try { payload=await response.json(); } catch {}
    if(!response.ok) {
      const message=payload.error||`Ollama вернул HTTP ${response.status}`;
      const hint=/not found/i.test(message)?` Установите её командой: ollama pull ${this.model}`:'';
      throw new AppError(`${message}.${hint}`,503,'AI_ERROR');
    }
    return payload;
  }
  async health() {
    try { const r=await this.fetchImpl(`${this.baseUrl}/api/tags`,{signal:AbortSignal.timeout(2000)}); return r.ok; } catch { return false; }
  }
}
