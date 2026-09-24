/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Offline fetch routes for the providers only this fork ships. Kept out of test/offlineFixtures.js
 * so upstream can change that file freely; it asks {@link forkFetchRoute} first and falls through
 * to its own routes when this answers null.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testFixtures');

const fixtureCache = new Map();

async function fixture(fileName) {
  if (!fixtureCache.has(fileName)) {
    let content = '';
    try {
      content = await readFile(path.join(FIXTURES_DIR, fileName), 'utf-8');
    } catch {
      // a missing fixture reads as an empty page, like upstream's tryReadFile fallback
    }
    fixtureCache.set(fileName, content);
  }
  return fixtureCache.get(fileName);
}

const htmlResponse = (html) => ({ ok: true, status: 200, text: () => Promise.resolve(html) });

/**
 * @param {string} urlStr the requested url
 * @param {RequestInit} [init] the fetch options
 * @returns {Promise<object|null>} a fetch-like response, or null when the url is not a fork route
 */
export async function forkFetchRoute(urlStr, init) {
  // The ImmoScout24 portal is read in three steps - list page for a session id, a POST that
  // stores the sort, then the pages - and every one of them is served the same sorted fixture,
  // except later pages, which are empty so the paging ends where the fixture does.
  if (urlStr.includes('portal.immobilienscout24.de/ergebnisliste/')) {
    const isLaterPage = /\/ergebnisliste\/\d+\/([2-9]|\d{2,})/.test(urlStr);
    return htmlResponse(isLaterPage ? '<ul class="result__list"></ul>' : await fixture('immoscoutPortal.html'));
  }

  if (urlStr.includes('portal.immobilienscout24.de/expose/')) {
    return htmlResponse(await fixture('immoscoutPortal_detail.html'));
  }

  // Wentzel Dr. posts its search to WordPress' admin-ajax.php and gets the rendered cards back.
  // The fixture is one page; any later page is answered empty so the provider's paging stops
  // where the live site's would.
  if (urlStr.includes('wentzel-dr.de/wp-admin/admin-ajax.php')) {
    const isLaterPage = /pagenum/.test(decodeURIComponent(String(init?.body ?? '')));
    return htmlResponse(isLaterPage ? '<div class="frymo-listing"></div>' : await fixture('wentzelDr.html'));
  }

  if (urlStr.includes('wentzel-dr.de/immobilie/')) {
    return htmlResponse(await fixture('wentzelDr_detail.html'));
  }

  return null;
}
