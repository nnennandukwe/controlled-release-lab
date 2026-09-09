import { describe, expect, it } from 'vitest';
import { search } from '../src/search.js';

describe('healthy ranked catalog search', () => {
  it('keeps original ordering by default and ranks matching names by price when enabled', () => {
    expect(search('keyboard').map(product => product.id)).toEqual(['keyboard-compact', 'keyboard-full']);
    expect(search('keyboard', true).map(product => product.id)).toEqual(['keyboard-full', 'keyboard-compact']);
  });
  it('puts name matches before description matches without changing membership', () => {
    expect(search('compact', true).map(product => product.id)).toEqual(['keyboard-compact', 'headphones-travel']);
    expect(search('COMPACT').map(product => product.id)).toEqual(['headphones-travel', 'keyboard-compact']);
  });
});
