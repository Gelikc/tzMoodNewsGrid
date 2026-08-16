import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts,validateFacts } from '../src/fact-validator.mjs';

test('извлекает числа, даты, цитаты и отрицания',()=>{
  const facts=extractFacts('15 августа компания не снизила цену на 25% и сообщила: «План сохранён».');
  assert.deepEqual(facts.numbers,['15','25%']); assert.equal(facts.negatives,1); assert.deepEqual(facts.quotes,['план сохранён']);
});
test('принимает стилистическую версию с теми же фактами',()=>{
  assert.equal(validateFacts('Компания не открыла 2 офиса.','К сожалению, компания не открыла 2 офиса.').status,'passed');
});
test('отклоняет изменённое число и отрицание',()=>{
  const result=validateFacts('Компания не открыла 2 офиса.','Компания открыла 3 офиса.');
  assert.equal(result.status,'failed'); assert.ok(result.missing.length); assert.ok(result.added.length);
});
test('считает словесное и цифровое числительное одним фактом',()=>{
  assert.equal(validateFacts('Два судна получили повреждения.','Сдержанно: 2 судна получили повреждения.').status,'passed');
});
test('отклоняет удаление или добавление именованных сущностей',()=>{
  const result=validateFacts('Петр Ян выступит на турнире UFC в Абу-Даби.','Петр Ян выступит на турнире UFC в Нью-Йорке.');
  assert.equal(result.status,'failed');
  assert.ok(result.missing.some(item=>item.type==='entities'));
  assert.ok(result.added.some(item=>item.type==='entities'));
});
