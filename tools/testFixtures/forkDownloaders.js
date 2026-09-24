/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* eslint-disable no-console */

/**
 * Fixture downloaders for the providers only this fork ships. downloadFixtures.js asks
 * {@link FORK_DOWNLOADERS} before its own switch, so that file stays upstream's.
 */

import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractFirstDetailUrl } from './extractDetailUrl.js';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'testFixtures');
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Wentzel Dr. renders its search through WordPress' admin-ajax.php, so the fixture is that
 * endpoint's answer for the configured search rather than the search page itself, which is the
 * same unfiltered ten cards whatever the url says. The detail fixture is the first card's exposé.
 *
 * @param {import('../../lib/types/providerConfig.js').ProviderConfig} runConfig the initialized provider config
 * @returns {Promise<void>}
 */
async function downloadWentzelDrFixtures(runConfig) {
  console.log('\nDownloading wentzelDr...');

  const { searchFiltersOf, fetchListingPage } = await import('../../lib/provider/wentzelDr.js');
  const html = await fetchListingPage(searchFiltersOf(runConfig.url), 1);
  if (!html) {
    console.warn('  Failed to download wentzelDr listing page');
    return;
  }

  await writeFile(path.join(FIXTURES_DIR, 'wentzelDr.html'), html, 'utf-8');
  console.log('  Saved wentzelDr.html');

  const detailUrl = extractFirstDetailUrl(html, runConfig);
  if (!detailUrl) {
    console.warn('  Could not find detail URL in wentzelDr list page');
    return;
  }

  console.log(`  Downloading wentzelDr detail (${detailUrl})...`);
  const detailResponse = await fetch(detailUrl, { headers: { 'User-Agent': BROWSER_USER_AGENT } });
  if (!detailResponse.ok) {
    console.warn(`  Failed to download wentzelDr detail: ${detailResponse.statusText}`);
    return;
  }

  await writeFile(path.join(FIXTURES_DIR, 'wentzelDr_detail.html'), await detailResponse.text(), 'utf-8');
  console.log('  Saved wentzelDr_detail.html');
}

/**
 * The ImmoScout24 portal lists arrive sorted by price unless a sort is posted into a session, and
 * the provider does exactly that. Its list fetch is reused so the fixture is the newest-first page
 * the provider reads live; the detail fixture is the first card's exposé.
 *
 * @param {import('../../lib/types/providerConfig.js').ProviderConfig} runConfig the initialized provider config
 * @returns {Promise<void>}
 */
async function downloadImmoscoutPortalFixtures(runConfig) {
  console.log('\nDownloading immoscoutPortal...');

  const portalId = runConfig.url.match(/\/ergebnisliste\/(\d+)/)?.[1];
  if (!portalId) {
    console.warn(`  Not a portal list url: ${runConfig.url}`);
    return;
  }
  const listUrl = `https://portal.immobilienscout24.de/ergebnisliste/${portalId}`;
  const headers = { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'de-DE,de;q=0.9' };

  const first = await fetch(listUrl, { headers });
  if (!first.ok) {
    console.warn(`  Failed to download immoscoutPortal list: ${first.statusText}`);
    return;
  }
  const sid = (await first.text()).match(/name="sid"\s+value="([^"]+)"/)?.[1];

  const sorted = await fetch(`${listUrl}/1?sid=${sid}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ sid: sid ?? '', 'sorting[sorting]': 'FirstActivation:DESC' }),
  });
  if (!sorted.ok) {
    console.warn(`  Failed to download the sorted immoscoutPortal list: ${sorted.statusText}`);
    return;
  }
  const html = await sorted.text();
  await writeFile(path.join(FIXTURES_DIR, 'immoscoutPortal.html'), html, 'utf-8');
  console.log('  Saved immoscoutPortal.html');

  const detailPath = html.match(/href="(\/expose\/\d+\/\d+[^"?]*)/)?.[1];
  if (!detailPath) {
    console.warn('  Could not find detail URL in immoscoutPortal list page');
    return;
  }
  const detail = await fetch(`https://portal.immobilienscout24.de${detailPath}`, { headers });
  if (!detail.ok) {
    console.warn(`  Failed to download immoscoutPortal detail: ${detail.statusText}`);
    return;
  }
  await writeFile(path.join(FIXTURES_DIR, 'immoscoutPortal_detail.html'), await detail.text(), 'utf-8');
  console.log('  Saved immoscoutPortal_detail.html');
}

/** Provider id to its downloader, each called with the provider's initialized run config. */
export const FORK_DOWNLOADERS = {
  wentzelDr: downloadWentzelDrFixtures,
  immoscoutPortal: downloadImmoscoutPortalFixtures,
};
