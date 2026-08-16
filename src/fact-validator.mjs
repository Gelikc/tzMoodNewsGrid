const normalize = value => value.toLocaleLowerCase('ru').replace(/[«»„“”]/g, '"').replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values.map(normalize).filter(Boolean))];
const numberWords={ноль:'0',один:'1',одна:'1',одно:'1',два:'2',две:'2',три:'3',четыре:'4',пять:'5',шесть:'6',семь:'7',восемь:'8',девять:'9',десять:'10'};
const canonicalNumbers=text=>unique([
  ...(text.match(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?:\s?(?:%|₽|\$|€|тыс\.?|млн|млрд))?/gu)||[]),
  ...[...text.matchAll(/(?<!\p{L})(ноль|один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)(?!\p{L})/giu)].map(match=>numberWords[match[1].toLowerCase()])
]);
const entityStopWords=new Set(['В','Во','На','По','После','До','От','Из','За','Для','При','Как','Но','А','И','Или','Это','Об','К','У','С','Со']);
const canonicalEntities=text=>unique([
  ...(text.match(/(?<![\p{L}\p{N}])(?:[А-ЯЁA-Z]{2,}|[А-ЯЁA-Z][\p{L}ёЁ-]+(?:\s+[А-ЯЁA-Z][\p{L}ёЁ-]+)+)(?![\p{L}\p{N}])/gu)||[]),
  ...(text.match(/(?<![\p{L}\p{N}])[А-ЯЁA-Z][\p{L}ёЁ]+-[А-ЯЁA-Z][\p{L}ёЁ]+(?![\p{L}\p{N}])/gu)||[])
].filter(value=>!entityStopWords.has(value)));

export function extractFacts(text) {
  return {
    numbers: canonicalNumbers(text),
    quotes: unique([...text.matchAll(/[«"]([^»"]{2,})[»"]/gu)].map(match => match[1])),
    dates: unique(text.match(/\b(?:\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)\b/giu) || []),
    negatives: (text.match(/(?<!\p{L})(?:не|нет|без|никогда|ни)(?!\p{L})/giu) || []).length,
    entities: canonicalEntities(text)
  };
}

export function validateFacts(source, candidate) {
  const original=extractFacts(source),output=extractFacts(candidate),missing=[],added=[];
  for(const type of ['numbers','quotes','dates','entities']) {
    for(const fact of original[type]) if(!output[type].includes(fact)) missing.push({type,value:fact});
    for(const fact of output[type]) if(!original[type].includes(fact)) added.push({type,value:fact});
  }
  if(original.negatives!==output.negatives) missing.push({type:'negation',value:`ожидалось ${original.negatives}, получено ${output.negatives}`});
  const lengthRatio=candidate.trim().length/Math.max(source.trim().length,1);
  const errors=[];
  if(!candidate.trim()) errors.push('Модель вернула пустой текст');
  if(lengthRatio<0.4||lengthRatio>2.2) errors.push('Длина результата слишком сильно отличается от оригинала');
  if(missing.length) errors.push('Пропали или изменились защищённые факты');
  if(added.length) errors.push('Добавлены новые защищённые факты или сущности');
  return {status:errors.length?'failed':'passed',errors,missing,added,lengthRatio:Number(lengthRatio.toFixed(2))};
}
