/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { providerDisplayName } from '../../ui/src/services/jobs/providerName.js';

const providers = [
  { id: 'wentzelDr', name: 'Wentzel Dr.' },
  { id: 'thor', name: 'Thor' },
];

describe('providerDisplayName', () => {
  it('prefers the name stored on the entry', () => {
    expect(providerDisplayName({ id: 'thor', name: 'My Thor' }, providers)).toBe('My Thor');
  });

  // A job created over the API carries only the id.
  it('falls back to the name the backend gives the id', () => {
    expect(providerDisplayName({ id: 'wentzelDr', url: 'https://wentzel-dr.de/' }, providers)).toBe('Wentzel Dr.');
    expect(providerDisplayName({ id: 'wentzelDr', name: '  ' }, providers)).toBe('Wentzel Dr.');
  });

  it('shows the id rather than nothing when the provider list has not loaded', () => {
    expect(providerDisplayName({ id: 'thor' }, [])).toBe('thor');
    expect(providerDisplayName({ id: 'thor' }, undefined)).toBe('thor');
  });

  it('copes with a missing entry', () => {
    expect(providerDisplayName(null, providers)).toBe('');
    expect(providerDisplayName({}, providers)).toBe('');
  });
});
