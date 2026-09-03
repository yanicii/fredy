/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { mockFredy, providerConfig } from '../utils.js';
import { describe, expect, it } from 'vitest';
import * as provider from '../../lib/provider/thor.js';

/** Run-scoped provider config, built per test via createConfig(). */
let runConfig;

describe('#thor testsuite()', () => {
  it('should test thor provider', async () => {
    const Fredy = await mockFredy();
    const mockedJob = {
      id: 'thor',
      notificationAdapter: null,
      spatialFilter: null,
      specFilter: null,
    };
    runConfig = provider.createConfig(providerConfig.thor, []);

    const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, undefined);

    const listing = await fredy.execute();

    if (listing == null || listing.length === 0) {
      throw new Error('Listings is empty!');
    }

    expect(listing).toBeInstanceOf(Array);
    const notificationObj = get();
    expect(notificationObj).toBeTypeOf('object');
    expect(notificationObj.serviceName).toBe('thor');
    notificationObj.payload.forEach((notify) => {
      /** check the actual structure **/
      expect(notify.id).toBeTypeOf('string');
      expect(notify.price).toBeTypeOf('string');
      expect(notify.price).toContain('€');
      expect(notify.size).toBeTypeOf('string');
      expect(notify.size).toContain('m²');
      expect(notify.title).toBeTypeOf('string');
      expect(notify.link).toBeTypeOf('string');
      expect(notify.link).toContain('immomio.com/de/apply/');
      expect(notify.address).toBeTypeOf('string');
      /** check the values if possible **/
      expect(notify.title).not.toBe('');
      expect(notify.address).not.toBe('');
    });
  });
});

describe('thor card parsing', () => {
  const text =
    '2-Zimmer Wohnung in Norderstedt, 62,48 m², 5. Etage, Küche, Bad/WC, Flur, Loggia, Dachboden ' +
    'Gleiwitzer Kehre 4, 22850 Norderstedt Miete inkl. EUR 973,00, Kaution frei ab 01.10.2026 ' +
    'Energieverbrauchsausweis, Kennwert 127,4 kWh / (m² * a), Fernwärme, Bj. 1965, Energieeffizienzklasse D';

  it('reads every fact out of the text block', () => {
    expect(provider.parseCard(text)).toEqual({
      title: '2-Zimmer Wohnung in Norderstedt',
      rooms: 2,
      size: 62.48,
      price: 973,
      buildYear: 1965,
      energyClass: 'D',
    });
  });

  it('reads half rooms and thousands', () => {
    const facts = provider.parseCard('2,5-Zimmer Wohnung in Barmbek, 71,10 m², Miete inkl. EUR 1.250,00, Bj. 1928');
    expect(facts.rooms).toBe(2.5);
    expect(facts.price).toBe(1250);
    expect(facts.buildYear).toBe(1928);
    expect(facts.energyClass).toBeNull();
  });

  it('copes with an empty card', () => {
    expect(provider.parseCard(null)).toEqual({
      title: null,
      rooms: null,
      size: null,
      price: null,
      buildYear: null,
      energyClass: null,
    });
  });

  it('normalizes a card', () => {
    const listing = provider.config.normalize({
      id: 'https://tenant.immomio.com/de/apply/febb5ba2-1a2c-48dc-90a2-198fe37faff7',
      link: 'https://tenant.immomio.com/de/apply/febb5ba2-1a2c-48dc-90a2-198fe37faff7',
      text,
      address: 'Gleiwitzer Kehre 4, 22850 Norderstedt',
      image: '/images/objekt/1.4207.2.596/listview001.jpg',
    });
    expect(listing.title).toBe('2-Zimmer Wohnung in Norderstedt');
    expect(listing.price).toBe(973);
    expect(listing.size).toBe(62.48);
    expect(listing.rooms).toBe(2);
    expect(listing.address).toBe('Gleiwitzer Kehre 4, 22850 Norderstedt');
    expect(listing.image).toBe('https://www.thor.de/images/objekt/1.4207.2.596/listview001.jpg');
    expect(listing.buildYear).toBe(1965);
    expect(listing.energyClass).toBe('D');
    expect(listing.description).toContain('Loggia');
  });

  it('keys the id on the application id and the rent', () => {
    const card = { link: 'https://tenant.immomio.com/de/apply/abc-123', text: 'X, 10 m², Miete inkl. EUR 500,00' };
    const a = provider.config.normalize(card);
    const b = provider.config.normalize({ ...card, link: 'https://tenant.immomio.com/de/apply/abc-123?utm=x' });
    const c = provider.config.normalize({ ...card, text: 'X, 10 m², Miete inkl. EUR 520,00' });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
});
