/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Groth & Schneider, a Hamburg property manager that lets most of its own stock directly.
 *
 * The site is a small WordPress install. `/aktuelle-angebote/` lists everything on one page - no
 * paging, no sort order - and the filters of its form (`typ[]`, `art[]`, `ort[]`) are plain GET
 * parameters the server honours, so the pasted search URL is used as it is.
 *
 * A card is an image with an overlay: the object type, a short list of facts, and nothing else. It
 * has no headline and no room count, and the same list drops the size for a parking space, so the
 * facts are read by what they contain rather than by position. The headline, the street, the rooms
 * and the build year all live on the detail page and arrive through `fetchDetails`.
 */

import * as cheerio from 'cheerio';
import { isOneOf, buildHash } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import { extractBuildingFacts, normalizeBuildYear } from '../utils/buildingFacts.js';
import puppeteerExtractor from '../services/extractor/puppeteerExtractor.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.grothschneider.de';

const REQUEST_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});

/**
 * Collapse whitespace the way the parser's `trim` modifier does.
 *
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
function cleanText(text) {
  const cleaned = text?.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned : null;
}

/**
 * The object's id, which is the `id` query parameter of its detail URL.
 *
 * @param {string|null|undefined} link
 * @returns {string|null}
 */
export function objectIdOf(link) {
  if (!link) return null;
  try {
    return new URL(link, BASE_URL).searchParams.get('id');
  } catch {
    return null;
  }
}

/**
 * Sort a card's facts by what they say.
 *
 * The overlay lists up to three items - `29,06 m²`, `900,00€ Kaltmiete`, `22049 Hamburg-Dulsberg` -
 * but a parking space has no size and a sale no rent label, so an item is recognised by its unit
 * rather than by its position.
 *
 * @param {Array<string|null|undefined>} facts The list items, in page order.
 * @returns {{size: string|null, price: string|null, address: string|null}}
 */
export function sortFacts(facts) {
  const sorted = { size: null, price: null, address: null };
  for (const fact of facts) {
    const text = cleanText(fact);
    if (text == null) continue;
    if (sorted.size == null && /m²/.test(text)) {
      sorted.size = text;
    } else if (sorted.price == null && /€/.test(text)) {
      sorted.price = text;
    } else if (sorted.address == null) {
      sorted.address = text;
    }
  }
  return sorted;
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const link = o.link ? new URL(o.link, BASE_URL).toString() : null;
  const { size, price, address } = sortFacts([o.fact1, o.fact2, o.fact3]);
  const type = cleanText(o.type)?.replace(/:$/, '') ?? null;
  // The card carries no headline. Until the detail page supplies the real one, the facts make a
  // title that still tells the notification apart from the next one.
  const title = [type, size, address].filter(Boolean).join(', ');

  return {
    id: buildHash(objectIdOf(o.link) ?? o.link, price),
    link,
    title,
    price: extractNumber(price),
    size: extractNumber(size),
    rooms: null,
    address,
    image: o.image ? new URL(o.image, BASE_URL).toString() : null,
    description: undefined,
  };
}

/**
 * Read one labelled fact out of the detail page's overview, e.g. the value after `Zimmer:`.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} label The label text, without the colon.
 * @returns {string|null}
 */
function readFact($, label) {
  let value = null;
  $('.objdetails p').each((_, el) => {
    if (value != null) return;
    const spanLabel = cleanText($(el).find('span').first().text())?.replace(/:$/, '');
    if (spanLabel === label) {
      value = cleanText($(el).clone().children('span').remove().end().text());
    }
  });
  return value;
}

/**
 * The text under one of the page's `<h2>` sections (Beschreibung, Ausstattung, Lage).
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} heading
 * @returns {string|null}
 */
function readSection($, heading) {
  const h2 = $('h2')
    .filter((_, el) => cleanText($(el).text()) === heading)
    .first();
  if (h2.length === 0) return null;
  return cleanText(h2.nextAll('p').first().text());
}

/**
 * The listing's price as the detail page states it.
 *
 * A rental shows `Kaltmiete:`, a sale `Kaufpreis:`; both are the figure the card shows, which is
 * what the price probe has to compare against.
 *
 * @param {string} html The detail page.
 * @returns {number|null}
 */
export function readDetailPrice(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const value = readFact($, 'Kaltmiete') ?? readFact($, 'Kaufpreis') ?? readFact($, 'Miete');
  return value == null ? null : extractNumber(value);
}

/**
 * Enrich a listing from its detail page: the real headline, the street, the room count, the build
 * year and the description the card has none of.
 *
 * Must always resolve: a page that cannot be read leaves the listing as the card described it.
 *
 * @param {ParsedListing} listing
 * @param {any} browser The shared browser instance.
 * @returns {Promise<ParsedListing>}
 */
async function fetchDetails(listing, browser) {
  try {
    const html = await puppeteerExtractor(listing.link, null, { browser, name: 'grothSchneider_details' });
    if (!html) return listing;

    const $ = cheerio.load(html);

    const h1 = $('.inlineoverlaycontent h1').first();
    const title = cleanText(h1.clone().children('span').remove().end().text()) ?? listing.title;

    // "Probsteier Straße 31a<br>22049 Hamburg-Dulsberg" - the line break separates street and town.
    const addressHtml = $('.inlineoverlaycontent p').first().html();
    const address =
      addressHtml == null
        ? listing.address
        : (cleanText(
            addressHtml
              .split(/<br\s*\/?>/i)
              .map((part) => cheerio.load(part).text())
              .map((part) => part.trim())
              .filter(Boolean)
              .join(', '),
          ) ?? listing.address);

    const description = [readSection($, 'Beschreibung'), readSection($, 'Ausstattung'), readSection($, 'Lage')]
      .filter(Boolean)
      .join('\n\n');

    const rooms = extractNumber(readFact($, 'Zimmer'));
    const buildYear = normalizeBuildYear(readFact($, 'Baujahr'));
    // The page states no efficiency class as a fact; the description occasionally mentions one.
    const { energyClass } = extractBuildingFacts(description);

    return {
      ...listing,
      title,
      address,
      description: description || listing.description,
      rooms: rooms ?? listing.rooms,
      size: listing.size ?? extractNumber(readFact($, 'Wohnfläche')),
      ...(buildYear != null ? { buildYear } : {}),
      ...(energyClass != null ? { energyClass } : {}),
    };
  } catch (error) {
    logger.warn(`Could not fetch Groth & Schneider detail page for listing '${listing.id}'.`, error?.message || error);
    return listing;
  }
}

/**
 * Whether a listing is still online.
 *
 * The site answers an unknown or withdrawn object with a 200 and an empty page - no headline, no
 * overview - so the status code alone says nothing and the overview block is what is looked for.
 *
 * @param {string} link
 * @returns {Promise<number>} 1 when active, 0 when gone, -1 when the answer could not be obtained.
 */
async function activityProbe(link) {
  try {
    const response = await fetch(link, { headers: REQUEST_HEADERS });
    if (response.status === 404 || response.status === 410) return 0;
    if (!response.ok) return -1;
    const html = await response.text();
    return /class="objdetails/.test(html) ? 1 : 0;
  } catch {
    return -1;
  }
}

/**
 * @param {ParsedListing} o
 * @param {string[]} appliedBlackList Terms the job wants filtered out.
 * @returns {boolean}
 */
function applyBlacklist(o, appliedBlackList) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);
  return titleNotBlacklisted && descNotBlacklisted;
}

/** @type {ProviderConfig} */
const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image', 'description'],
  url: null,
  crawlContainer: '.grid-item',
  // The page offers no sort order; it is short enough to be read whole on every run.
  sortByDateParam: null,
  waitForSelector: null,
  crawlFields: {
    id: 'a.gridcontent@href',
    link: 'a.gridcontent@href',
    type: '.typ | trim',
    // read positionally here and sorted by content in normalize, see sortFacts
    fact1: '.quickdetail li:nth-of-type(1) | trim',
    fact2: '.quickdetail li:nth-of-type(2) | trim',
    fact3: '.quickdetail li:nth-of-type(3) | trim',
    image: 'img@src',
  },
  normalize,
  fetchDetails,
  activityProbe,
  priceTracking: {
    extract: readDetailPrice,
  },
};

/**
 * Build a run-scoped provider configuration.
 *
 * Returns a fresh object on every call instead of mutating module-level state. Two jobs can be in
 * flight at once - a manual run started while the scheduler is working through the others - and a
 * shared mutable config meant the second job overwrote the first job's URL and blacklist mid-run,
 * so listings were fetched for one job and stored under another.
 *
 * @param {{url: string, enabled?: boolean}} sourceConfig The job's entry for this provider.
 * @param {string[]} [blacklist] Terms to filter listings out by.
 * @returns {ProviderConfig} A configuration usable by a single pipeline run.
 */
export const createConfig = (sourceConfig, blacklist = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? []),
});

export const metaInformation = {
  countries: ['de'],
  name: 'Groth & Schneider',
  baseUrl: BASE_URL,
  id: 'grothSchneider',
};

export { config };
