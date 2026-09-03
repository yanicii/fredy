/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { mockFredy, providerConfig } from '../utils.js';
import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import * as provider from '../../lib/provider/grothSchneider.js';

/** Run-scoped provider config, built per test via createConfig(). */
let runConfig;

describe('#grothSchneider testsuite()', () => {
  it('should test grothSchneider provider', async () => {
    const Fredy = await mockFredy();
    const mockedJob = {
      id: 'grothSchneider',
      notificationAdapter: null,
      spatialFilter: null,
      specFilter: null,
    };
    runConfig = provider.createConfig(providerConfig.grothSchneider, []);

    const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, undefined);

    const listing = await fredy.execute();

    if (listing == null || listing.length === 0) {
      throw new Error('Listings is empty!');
    }

    expect(listing).toBeInstanceOf(Array);
    const notificationObj = get();
    expect(notificationObj).toBeTypeOf('object');
    expect(notificationObj.serviceName).toBe('grothSchneider');
    notificationObj.payload.forEach((notify) => {
      /** check the actual structure **/
      expect(notify.id).toBeTypeOf('string');
      expect(notify.price).toBeTypeOf('string');
      expect(notify.price).toContain('€');
      expect(notify.size).toBeTypeOf('string');
      expect(notify.size).toContain('m²');
      expect(notify.title).toBeTypeOf('string');
      expect(notify.link).toBeTypeOf('string');
      expect(notify.link).toContain('grothschneider.de/objekt/?id=');
      expect(notify.address).toBeTypeOf('string');
      /** check the values if possible **/
      expect(notify.title).not.toBe('');
      expect(notify.address).not.toBe('');
    });
  });

  it('enriches a listing from the detail page', async () => {
    runConfig = provider.createConfig(providerConfig.grothSchneider, []);
    const enriched = await runConfig.fetchDetails(
      {
        id: 'x',
        link: 'https://www.grothschneider.de/objekt/?id=223AFF47C1634C0EB89933B14F3354F3',
        title: 'Wohnung, 29,06 m², 22049 Hamburg-Dulsberg',
        price: 900,
        size: 29.06,
        rooms: null,
        address: '22049 Hamburg-Dulsberg',
        image: null,
      },
      undefined,
    );

    expect(enriched.title).toBe('Möbliertes Neubau-Apartment inkl. WLAN + Strom');
    expect(enriched.address).toBe('Probsteier Straße 31a, 22049 Hamburg-Dulsberg');
    expect(enriched.rooms).toBe(1);
    expect(enriched.buildYear).toBe(2024);
    expect(enriched.description).toContain('Diese Wohnung bieten wir aus unserem Verwaltungsbestand');
    expect(enriched.description).toContain('Zentralheizung über Fernwärme');
    // the card's facts survive the enrichment
    expect(enriched.price).toBe(900);
    expect(enriched.size).toBe(29.06);
  });

  it('reads the price the card shows off the detail page', async () => {
    const html = await readFile(new URL('../testFixtures/grothSchneider_detail.html', import.meta.url), 'utf-8');
    expect(provider.readDetailPrice(html)).toBe(900);
    expect(provider.readDetailPrice('<html></html>')).toBeNull();
  });
});

describe('grothSchneider normalize', () => {
  const card = {
    id: 'https://www.grothschneider.de/objekt/?id=223AFF47C1634C0EB89933B14F3354F3',
    link: 'https://www.grothschneider.de/objekt/?id=223AFF47C1634C0EB89933B14F3354F3',
    type: 'Wohnung:',
    fact1: '29,06 m²',
    fact2: '900,00€ Kaltmiete',
    fact3: '22049 Hamburg-Dulsberg',
    image: 'https://www.grothschneider.de/immo/223AFF47C1634C0EB89933B14F3354F3/b4fad5d8.jpeg',
  };

  it('reads an apartment card', () => {
    const listing = provider.config.normalize(card);
    expect(listing.price).toBe(900);
    expect(listing.size).toBe(29.06);
    expect(listing.rooms).toBeNull();
    expect(listing.address).toBe('22049 Hamburg-Dulsberg');
    expect(listing.title).toBe('Wohnung, 29,06 m², 22049 Hamburg-Dulsberg');
    expect(listing.link).toBe(card.link);
  });

  it('reads a sale, whose price carries no label', () => {
    const listing = provider.config.normalize({ ...card, fact2: '875.000,00€' });
    expect(listing.price).toBe(875000);
  });

  // A parking space lists rent and town only, so the facts shift up by one.
  it('does not mistake the address of a parking space for its size', () => {
    const listing = provider.config.normalize({
      ...card,
      type: 'Stellplatz:',
      fact1: '100,00€ Kaltmiete',
      fact2: '22089 Hamburg',
      fact3: null,
    });
    expect(listing.size).toBeNull();
    expect(listing.price).toBe(100);
    expect(listing.address).toBe('22089 Hamburg');
    expect(listing.title).toBe('Stellplatz, 22089 Hamburg');
  });

  it('keys the id on the object id and the price', () => {
    const before = provider.config.normalize(card);
    const sameObjectOtherHost = provider.config.normalize({
      ...card,
      link: '/objekt/?id=223AFF47C1634C0EB89933B14F3354F3',
    });
    const repriced = provider.config.normalize({ ...card, fact2: '950,00€ Kaltmiete' });
    expect(sameObjectOtherHost.id).toBe(before.id);
    expect(sameObjectOtherHost.link).toBe(card.link);
    expect(repriced.id).not.toBe(before.id);
  });

  it('reads the object id off the link', () => {
    expect(provider.objectIdOf(card.link)).toBe('223AFF47C1634C0EB89933B14F3354F3');
    expect(provider.objectIdOf(null)).toBeNull();
  });

  it('sorts the facts by their unit', () => {
    expect(provider.sortFacts(['22301 Hamburg', '84,40 m²', '875.000,00€'])).toEqual({
      size: '84,40 m²',
      price: '875.000,00€',
      address: '22301 Hamburg',
    });
  });
});
