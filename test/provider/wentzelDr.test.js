/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { mockFredy, providerConfig } from '../utils.js';
import { describe, expect, it } from 'vitest';
import * as provider from '../../lib/provider/wentzelDr.js';

/** Run-scoped provider config, built per test via createConfig(). */
let runConfig;

describe('#wentzelDr testsuite()', () => {
  it('should test wentzelDr provider', async () => {
    const Fredy = await mockFredy();
    const mockedJob = {
      id: 'wentzelDr',
      notificationAdapter: null,
      spatialFilter: null,
      specFilter: null,
    };
    runConfig = provider.createConfig(providerConfig.wentzelDr, []);

    const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, undefined);

    const listing = await fredy.execute();

    if (listing == null || listing.length === 0) {
      throw new Error('Listings is empty!');
    }

    expect(listing).toBeInstanceOf(Array);
    const notificationObj = get();
    expect(notificationObj).toBeTypeOf('object');
    expect(notificationObj.serviceName).toBe('wentzelDr');
    notificationObj.payload.forEach((notify) => {
      /** check the actual structure **/
      expect(notify.id).toBeTypeOf('string');
      expect(notify.price).toBeTypeOf('string');
      expect(notify.price).toContain('€');
      expect(notify.size).toBeTypeOf('string');
      expect(notify.size).toContain('m²');
      expect(notify.title).toBeTypeOf('string');
      expect(notify.link).toBeTypeOf('string');
      expect(notify.link).toContain('wentzel-dr.de/immobilie/');
      expect(notify.address).toBeTypeOf('string');
      /** check the values if possible **/
      expect(notify.title).not.toBe('');
      expect(notify.address).not.toBe('');
    });
  });

  // The pipeline caps detail fetches at one in the test harness, so the enrichment is checked on the
  // provider directly against the recorded exposé.
  it('enriches a listing from the exposé', async () => {
    runConfig = provider.createConfig(providerConfig.wentzelDr, []);
    const enriched = await runConfig.fetchDetails({
      id: 'x',
      link: 'https://wentzel-dr.de/immobilie/4-zimmer-familientraum-in-hamburg-tonndorf-wentzel-dr/',
      title: '4-Zimmer-Familientraum in Hamburg Tonndorf',
      price: 1719,
      size: 95.51,
      rooms: 4,
      address: 'Hamburg',
      image: null,
    });

    expect(enriched.address).toBe('22159 Hamburg');
    expect(enriched.description).toContain('Mit seiner prägnanten Architektur');
    expect(enriched.buildYear).toBe(2021);
    expect(enriched.energyClass).toBe('B');
    // the card's facts survive the enrichment
    expect(enriched.price).toBe(1719);
    expect(enriched.rooms).toBe(4);
  });
});

describe('wentzelDr search filters', () => {
  const encode = (query) =>
    `https://wentzel-dr.de/immobilien/?frymo_query=${encodeURIComponent(JSON.stringify(query))}`;

  it('reads the filters out of the pasted url and forces newest-first', () => {
    const filters = provider.searchFiltersOf(
      encode({ 68389: { marketing_type: '218', search_string: 'Hamburg', order_by: 'price_asc' } }),
    );
    expect(filters).toEqual({ marketing_type: '218', search_string: 'Hamburg', order_by: 'date_asc' });
  });

  // Frymo labels `date_desc` "älteste zuerst" and means it; a url copied from a previous scraper
  // carried exactly that, so the order is never taken from the url.
  it('replaces the reversed date order a bookmarked url may carry', () => {
    const filters = provider.searchFiltersOf(encode({ 68389: { order_by: 'date_desc' } }));
    expect(filters.order_by).toBe('date_asc');
  });

  it('accepts the query id an older url was keyed by', () => {
    const filters = provider.searchFiltersOf(encode({ 'kauf-suche': { rooms_from: '2.5', marketing_type: '218' } }));
    expect(filters).toEqual({ rooms_from: '2.5', marketing_type: '218', order_by: 'date_asc' });
  });

  it('drops the page a bookmarked url stopped on', () => {
    const filters = provider.searchFiltersOf(encode({ 68389: { marketing_type: '218', pagenum: 4 } }));
    expect(filters).not.toHaveProperty('pagenum');
  });

  it('searches everything when the url carries no query', () => {
    expect(provider.searchFiltersOf('https://wentzel-dr.de/immobilien/')).toEqual({ order_by: 'date_asc' });
  });

  it('searches everything when the query is not json', () => {
    expect(provider.searchFiltersOf('https://wentzel-dr.de/immobilien/?frymo_query=%7Bnope')).toEqual({
      order_by: 'date_asc',
    });
  });
});

describe('wentzelDr normalize', () => {
  it('reads German numbers off the card', () => {
    const listing = provider.config.normalize({
      id: 'https://wentzel-dr.de/immobilie/test-wentzel-dr/',
      link: 'https://wentzel-dr.de/immobilie/test-wentzel-dr/',
      title: 'Testwohnung – Wentzel Dr.',
      price: '1.006,84 €',
      size: '65,18 m²',
      rooms: '2,5',
      address: 'Hamburg',
      image: 'https://wentzel-dr.de/wp-content/uploads/x.jpg',
    });

    expect(listing.price).toBe(1006.84);
    expect(listing.size).toBe(65.18);
    expect(listing.rooms).toBe(2.5);
    expect(listing.link).toBe('https://wentzel-dr.de/immobilie/test-wentzel-dr/');
    expect(listing.id).toBeTypeOf('string');
  });

  it('gives a repriced listing a new id', () => {
    const card = { id: '/immobilie/a/', link: '/immobilie/a/', title: 't', price: '700 €' };
    const before = provider.config.normalize(card);
    const after = provider.config.normalize({ ...card, price: '750 €' });
    expect(before.id).not.toBe(after.id);
    expect(after.link).toBe('https://wentzel-dr.de/immobilie/a/');
  });
});
