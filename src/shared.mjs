import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(String(value)).digest('hex');

export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

export const decodeEntities = (input = '') => {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return input.replace(/&(#x?[\da-f]+|\w+);/gi, (_, entity) => {
    if (entity[0] !== '#') return named[entity] ?? `&${entity};`;
    const hex = entity[1]?.toLowerCase() === 'x';
    return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
};

export const cleanText = (input = '') => {
  let value = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  value = decodeEntities(decodeEntities(value));
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};
