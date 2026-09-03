/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { mockFredy, providerConfig } from '../utils.js';
import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import * as provider from '../../lib/provider/immoscoutPortal.js';

/** Run-scoped provider config, built per test via createConfig(). */
let runConfig;

describe('#immoscoutPortal testsuite()', () => {
  it('should test immoscoutPortal provider', async () => {
    const Fredy = await mockFredy();
    const mockedJob = {
      id: 'immoscoutPortal',
      notificationAdapter: null,
      spatialFilter: null,
      specFilter: null,
    };
    runConfig = provider.createConfig(providerConfig.immoscoutPortal, []);

    const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache, undefined);

    const listing = await fredy.execute();

    if (listing == null || listing.length === 0) {
      throw new Error('Listings is empty!');
    }

    expect(listing).toBeInstanceOf(Array);
    const notificationObj = get();
    expect(notificationObj).toBeTypeOf('object');
    expect(notificationObj.serviceName).toBe('immoscoutPortal');
    notificationObj.payload.forEach((notify) => {
      /** check the actual structure **/
      expect(notify.id).toBeTypeOf('string');
      expect(notify.price).toBeTypeOf('string');
      expect(notify.price).toContain('€');
      expect(notify.size).toBeTypeOf('string');
      expect(notify.size).toContain('m²');
      expect(notify.title).toBeTypeOf('string');
      expect(notify.link).toBeTypeOf('string');
      expect(notify.link).toContain('portal.immobilienscout24.de/expose/');
      expect(notify.link).not.toContain('sid=');
      expect(notify.address).toBeTypeOf('string');
      /** check the values if possible **/
      expect(notify.title).not.toBe('');
      expect(notify.address).not.toBe('');
    });
  });

  it('enriches a listing from the exposé', async () => {
    runConfig = provider.createConfig(providerConfig.immoscoutPortal, []);
    const enriched = await runConfig.fetchDetails({
      id: 'x',
      link: 'https://portal.immobilienscout24.de/expose/84239610/168836265/1/1',
      title: 'Freistehendes Einfamilienhaus in beliebter Lage von Finkenwerder',
      price: 269000,
      size: 107,
      rooms: 5,
      address: '21129 Hamburg, Finkenwerder',
      image: null,
    });
    expect(enriched.description).toContain('Rotklinker-Einfamilienhaus');
    expect(enriched.description).toContain('Finkenwerder');
    expect(enriched.energyClass).toBe('H');
    // this exposé names no Baujahr fact and its prose says "aus dem Jahr ca. 1907", which is not a
    // labelled build year either, so none is invented
    expect(enriched.buildYear).toBeUndefined();
    expect(enriched.price).toBe(269000);
  });

  it('reads the price the list shows off the exposé', async () => {
    const html = await readFile(new URL('../testFixtures/immoscoutPortal_detail.html', import.meta.url), 'utf-8');
    expect(provider.readDetailPrice(html)).toBe(269000);
    expect(provider.readDetailPrice('<html></html>')).toBeNull();
  });
});

describe('immoscoutPortal urls', () => {
  it('reads the portal id off the list url', () => {
    expect(provider.portalIdOf('https://portal.immobilienscout24.de/ergebnisliste/84239610')).toBe('84239610');
    expect(provider.portalIdOf('https://portal.immobilienscout24.de/ergebnisliste/17575537/2?sid=abc')).toBe(
      '17575537',
    );
    expect(provider.portalIdOf('https://www.immobilienscout24.de/Suche/')).toBeNull();
  });

  it('drops the session id from an exposé link and makes it absolute', () => {
    expect(provider.canonicalLink('/expose/84239610/168836265/1/1?sid=712uvft3n08f5s01jjd2svieo7')).toBe(
      'https://portal.immobilienscout24.de/expose/84239610/168836265/1/1',
    );
    expect(provider.canonicalLink(null)).toBeNull();
  });
});

describe('immoscoutPortal normalize', () => {
  const card = {
    id: '/expose/84239610/168836265/1/1?sid=abc',
    link: '/expose/84239610/168836265/1/1?sid=abc',
    title: 'Freistehendes Einfamilienhaus in beliebter Lage von Finkenwerder',
    address: '21129 Hamburg, Finkenwerder',
    image: '//pictures.immobilienscout24.de/listings/x.jpg/ORIG/resize/540x540%3E/format/jpg',
    label1: 'Kaufpreis',
    value1: '€ 269.000',
    label2: 'Wohnfläche',
    value2: '107 m²',
    label3: 'Zimmer',
    value3: '5',
  };

  it('reads a card', () => {
    const listing = provider.config.normalize(card);
    expect(listing.price).toBe(269000);
    expect(listing.size).toBe(107);
    expect(listing.rooms).toBe(5);
    expect(listing.address).toBe('21129 Hamburg, Finkenwerder');
    expect(listing.link).toBe('https://portal.immobilienscout24.de/expose/84239610/168836265/1/1');
    expect(listing.image).toBe(
      'https://pictures.immobilienscout24.de/listings/x.jpg/ORIG/resize/540x540%3E/format/jpg',
    );
  });

  it('matches the facts by label, not by position', () => {
    const shuffled = provider.config.normalize({
      ...card,
      label1: 'Zimmer',
      value1: '2',
      label2: 'Kaltmiete',
      value2: '€ 984,90',
      label3: 'Wohnfläche',
      value3: '65,3 m²',
    });
    expect(shuffled.rooms).toBe(2);
    expect(shuffled.price).toBe(984.9);
    expect(shuffled.size).toBe(65.3);
  });

  it('keeps the id stable across sessions and changes it with the price', () => {
    const a = provider.config.normalize(card);
    const b = provider.config.normalize({ ...card, link: '/expose/84239610/168836265/1/1?sid=other' });
    const c = provider.config.normalize({ ...card, value1: '€ 259.000' });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
});
