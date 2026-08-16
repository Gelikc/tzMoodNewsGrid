import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaProvider } from '../src/ollama-provider.mjs';

test('извлекает только поле text из структурированного ответа Ollama',async()=>{
  const fetchImpl=async(_url,options)=>{
    const request=JSON.parse(options.body);assert.equal(request.format.properties.text.type,'string');
    return {ok:true,json:async()=>({message:{content:JSON.stringify({text:'Ироничная, но фактическая версия.'})}})};
  };
  const provider=new OllamaProvider({baseUrl:'http://ollama',model:'qwen3:4b',fetchImpl});
  assert.equal(await provider.generate({system:'instruction',user:'news'}),'Ироничная, но фактическая версия.');
});

test('удаляет блок рассуждений из ответа старой модели',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({message:{content:'<think>Не показывать пользователю</think>{"text":"Готовый текст."}'}})});
  const provider=new OllamaProvider({baseUrl:'http://ollama',model:'qwen3:4b',fetchImpl});
  assert.equal(await provider.generate({system:'instruction',user:'news'}),'Готовый текст.');
});

test('семантическая проверка возвращает решение и причину',async()=>{
  const fetchImpl=async(_url,options)=>{const request=JSON.parse(options.body);assert.equal(request.format.properties.passed.type,'boolean');return {ok:true,json:async()=>({message:{content:'{"passed":false,"reason":"Изменена роль человека"}'}})}};
  const provider=new OllamaProvider({baseUrl:'http://ollama',model:'qwen3:4b',fetchImpl});
  assert.deepEqual(await provider.verifyFacts({source:'Оригинал',candidate:'Версия'}),{passed:false,reason:'Изменена роль человека'});
});
