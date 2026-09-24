/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, expect } from 'vitest';
import { mockFredy } from '../utils.js';
import * as mockStore from '../mocks/mockStore.js';
import { get as getLastNotification } from '../mocks/mockNotification.js';

describe('Spec filter is re-applied after detail enrichment', () => {
  afterEach(() => {
    mockStore.setUserSettings(null);
  });

  // Some search cards name no room count at all - Groth & Schneider's, for one - so a minimum-rooms
  // filter has nothing to compare against until the detail page has been read.
  it('drops a listing whose room count only the detail page revealed', async () => {
    const Fredy = await mockFredy();
    const providerId = 'test-provider';

    mockStore.setUserSettings({ provider_details: [providerId] });

    const providerConfig = {
      url: 'http://example.com',
      getListings: () =>
        Promise.resolve([
          {
            id: 'roomy',
            title: 'Three rooms',
            address: 'A',
            price: 900,
            rooms: null,
            link: 'http://example.com/roomy',
          },
          { id: 'tiny', title: 'One room', address: 'B', price: 500, rooms: null, link: 'http://example.com/tiny' },
        ]),
      normalize: (l) => l,
      filter: () => true,
      fetchDetails: (listing) => Promise.resolve({ ...listing, rooms: listing.id === 'tiny' ? 1 : 3 }),
      crawlFields: { id: 'id', title: 'title', address: 'address', price: 'price', rooms: 'rooms', link: 'link' },
      requiredFieldNames: ['id', 'title', 'address', 'price', 'rooms', 'link'],
    };

    const mockedJob = {
      id: 'spec-after-details-job',
      notificationAdapter: null,
      specFilter: { minRooms: 2 },
      spatialFilter: null,
    };

    const fredy = new Fredy(
      providerConfig,
      mockedJob,
      providerId,
      { checkAndAddEntry: () => false },
      undefined,
      // both listings have to be enriched for the second one to be judged
      { maxDetailFetches: null },
    );

    const result = await fredy.execute();
    const ids = result.map((l) => l.id);
    expect(ids).toContain('roomy');
    expect(ids).not.toContain('tiny');

    const notifiedIds = (getLastNotification()?.payload ?? []).map((p) => p.id);
    expect(notifiedIds).toContain('roomy');
    expect(notifiedIds).not.toContain('tiny');
  });
});
