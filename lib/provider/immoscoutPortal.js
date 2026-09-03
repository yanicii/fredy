/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The result lists ImmoScout24 hosts for individual landlords and property managers under
 * `portal.immobilienscout24.de/ergebnisliste/<portal id>`. Every such portal shares one markup,
 * so a single provider serves all of them: paste the portal's list URL and the number in it says
 * whose stock to watch. Nothing here talks to ImmoScout24's own search, which is `immoscout`.
 *
 * The list is server-rendered and unprotected, but it comes sorted by price and offers "neueste
 * zuerst" only through a POST that stores the choice in a server-side session. A run therefore
 * takes three steps: read the list page for a session id, post the sort with it, then read the
 * pages with that id so they arrive newest-first.
 */

import * as cheerio from 'cheerio';
import { isOneOf, buildHash } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
import { extractBuildingFacts, normalizeBuildYear, normalizeEnergyClass } from '../utils/buildingFacts.js';
import { parse } from '../services/extractor/parser/parser.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://portal.immobilienscout24.de';

/** Fifteen results per page. Fewer means the last page has been reached. */
const PAGE_SIZE = 15;

/**
 * How many pages to walk per run. The largest portal seen so far had three; two pages of
 * newest-first is ample for a job that runs every few minutes.
 */
const MAX_PAGES = 2;

/** The sort form's value for "Aktualität (neueste zuerst)". */
const NEWEST_FIRST = 'FirstActivation:DESC';

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
 * The portal id named in a pasted list URL.
 *
 * @param {string} url e.g. `https://portal.immobilienscout24.de/ergebnisliste/84239610`
 * @returns {string|null}
 */
export function portalIdOf(url) {
  return String(url ?? '').match(/\/ergebnisliste\/(\d+)/)?.[1] ?? null;
}

/**
 * Strip the session id off a link so the same exposé reads the same on every run.
 *
 * @param {string|null|undefined} href Relative or absolute.
 * @returns {string|null}
 */
export function canonicalLink(href) {
  if (!href) return null;
  try {
    const url = new URL(href, BASE_URL);
    url.searchParams.delete('sid');
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {string} [what] Named in the log line when the request fails.
 * @returns {Promise<string|null>}
 */
async function getHtml(url, init = {}, what = 'the page') {
  const response = await fetch(url, { ...init, headers: { ...REQUEST_HEADERS, ...(init.headers ?? {}) } });
  if (!response.ok) {
    logger.error(`Error fetching ${what} from the ImmoScout24 portal: ${response.status} ${response.statusText}`);
    return null;
  }
  return response.text();
}

/**
 * Fetch the portal's result pages, newest first.
 *
 * @param {string} url The job's list URL.
 * @returns {Promise<Object[]>} Raw listing cards as the crawl fields read them.
 */
async function getListings(url) {
  const portalId = portalIdOf(url);
  if (portalId == null) {
    logger.error(`Not an ImmoScout24 portal list URL: ${url}`);
    return [];
  }
  const listUrl = `${BASE_URL}/ergebnisliste/${portalId}`;

  const firstPage = await getHtml(listUrl, {}, 'the result list');
  if (firstPage == null) return [];

  // The sort form carries the session id as a hidden field. Without a session the sort cannot be
  // stored, so the unsorted first page is the best that can be done.
  const sid = firstPage.match(/name="sid"\s+value="([^"]+)"/)?.[1];
  if (!sid) {
    logger.warn('The ImmoScout24 portal handed out no session id; results are read in the portal’s own order.');
    return parse(config.crawlContainer, config.crawlFields, firstPage, url) ?? [];
  }

  const sorted = await getHtml(
    `${listUrl}/1?sid=${sid}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ sid, 'sorting[sorting]': NEWEST_FIRST }),
    },
    'the sorted result list',
  );
  if (sorted == null) {
    return parse(config.crawlContainer, config.crawlFields, firstPage, url) ?? [];
  }

  const listings = parse(config.crawlContainer, config.crawlFields, sorted, url) ?? [];
  for (let pagenum = 2; pagenum <= MAX_PAGES && listings.length >= PAGE_SIZE * (pagenum - 1); pagenum++) {
    const page = await getHtml(`${listUrl}/${pagenum}?sid=${sid}`, {}, `result page ${pagenum}`);
    if (page == null) break;
    listings.push(...(parse(config.crawlContainer, config.crawlFields, page, url) ?? []));
  }
  return listings;
}

/**
 * Sort a card's three labelled facts by their label.
 *
 * A card lists `Kaltmiete` (or `Kaufpreis`), `Wohnfläche` and `Zimmer`, in that order today; the
 * label is what is trusted, not the position.
 *
 * @param {any} o The raw card.
 * @returns {{price: string|null, size: string|null, rooms: string|null}}
 */
export function sortFacts(o) {
  const facts = { price: null, size: null, rooms: null };
  for (const n of [1, 2, 3]) {
    const label = cleanText(o[`label${n}`]) ?? '';
    const value = cleanText(o[`value${n}`]);
    if (value == null) continue;
    // Commercial space is priced "Miete pro Quadratmeter"; that is a rate, not a rent, and reading
    // it as one would file a 273 m² office as a 17 € flat.
    if (/pro (Quadratmeter|m²)/i.test(label)) continue;
    if (/Kaltmiete|Kaufpreis|Miete|Preis/i.test(label)) facts.price ??= value;
    else if (/fläche/i.test(label)) facts.size ??= value;
    else if (/Zimmer/i.test(label)) facts.rooms ??= value;
  }
  return facts;
}

/**
 * Whether a card's type line names a home.
 *
 * A portal lists whatever its manager has: flats and houses, but also "Büros/Praxen",
 * "Garage/Stellplatz/Miete", "Gewerbe" and "Grundstück". Fredy looks for somewhere to live, so
 * only the first two get through. A card without a type line is kept, since nothing says it is not
 * a home.
 *
 * @param {string|null|undefined} type The card's type line, e.g. `Wohnung zur Miete`.
 * @returns {boolean}
 */
export function isResidential(type) {
  const text = cleanText(type);
  if (text == null) return true;
  return /^(Wohnung|Haus|Häuser|Wohnungen)\b/i.test(text);
}

/**
 * The number in a card value such as `€ 269.000` or `65,3 m²`.
 *
 * `extractNumber` parses from the first character and gives up on a leading currency sign, so the
 * numeric run is cut out first.
 *
 * @param {string|null|undefined} text
 * @returns {number|null}
 */
function numberOf(text) {
  return extractNumber(text?.match(/\d[\d.,]*/)?.[0]);
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const link = canonicalLink(o.link);
  const { price, size, rooms } = sortFacts(o);
  // `/expose/<portal>/<exposé>/1/1` - the two numbers name the listing
  const exposeId = String(o.link ?? '').match(/\/expose\/(\d+\/\d+)/)?.[1] ?? o.link;
  const image = o.image ? String(o.image) : null;
  return {
    id: buildHash(exposeId, price),
    link,
    title: cleanText(o.title) ?? '',
    price: numberOf(price),
    size: numberOf(size),
    rooms: numberOf(rooms),
    // "21129 Hamburg, Finkenwerder" - the postcode and the district are all the portal shows
    address: cleanText(o.address),
    image: image?.startsWith('//') ? `https:${image}` : image,
    description: undefined,
    // not a ParsedListing field and never stored; carried to the filter, which drops offices and
    // parking spaces by it
    objectType: cleanText(o.type),
  };
}

/**
 * The value of one labelled fact in an exposé's `<ul>` blocks, e.g. the text after `Baujahr:`.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {RegExp} label
 * @returns {string|null}
 */
function readFact($, label) {
  let value = null;
  $('.expose--text li').each((_, el) => {
    if (value != null) return;
    const ps = $(el).children('p');
    if (ps.length < 2) return;
    if (label.test(cleanText(ps.first().text()) ?? '')) {
      value = cleanText(ps.eq(1).text());
    }
  });
  return value;
}

/**
 * The paragraphs under one `<h4>` heading of the exposé (Objektbeschreibung, Lage, …).
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} heading
 * @returns {string|null}
 */
function readSection($, heading) {
  const block = $('.expose--text')
    .filter((_, el) => cleanText($(el).children('h4').first().text()) === heading)
    .first();
  if (block.length === 0) return null;
  return cleanText(
    block
      .children('p')
      .map((_, p) => $(p).text())
      .get()
      .join('\n'),
  );
}

/**
 * The exposé's price, as the price probe compares it against the list.
 *
 * @param {string} html
 * @returns {number|null}
 */
export function readDetailPrice(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const value = readFact($, /^(Kaltmiete|Kaufpreis)/i);
  return value == null ? null : numberOf(value);
}

/**
 * Enrich a listing from its exposé: description, location text, energy class and build year.
 *
 * The exposé hides the street ("Die vollständige Adresse erhalten Sie vom Anbieter"), so the card's
 * postcode and district stay. Must always resolve.
 *
 * @param {ParsedListing} listing
 * @returns {Promise<ParsedListing>}
 */
async function fetchDetails(listing) {
  try {
    const html = await getHtml(listing.link, {}, `the exposé of '${listing.id}'`);
    if (!html) return listing;
    const $ = cheerio.load(html);

    const description = [readSection($, 'Objektbeschreibung'), readSection($, 'Ausstattung'), readSection($, 'Lage')]
      .filter(Boolean)
      .join('\n\n');

    const fromText = extractBuildingFacts(description);
    const buildYear = normalizeBuildYear(readFact($, /^Baujahr/i)) ?? fromText.buildYear;
    const energyClass = normalizeEnergyClass(readFact($, /^Energieeffizienzklasse/i)) ?? fromText.energyClass;

    return {
      ...listing,
      description: description || listing.description,
      ...(buildYear != null ? { buildYear } : {}),
      ...(energyClass != null ? { energyClass } : {}),
    };
  } catch (error) {
    logger.warn(`Could not fetch the ImmoScout24 portal exposé for listing '${listing.id}'.`, error?.message || error);
    return listing;
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
  return isResidential(o.objectType) && titleNotBlacklisted && descNotBlacklisted;
}

/** @type {ProviderConfig} */
const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image', 'description'],
  url: null,
  crawlContainer: 'li.result__list--element',
  // The sort is a session setting, not a query parameter; getListings posts it.
  sortByDateParam: null,
  waitForSelector: null,
  crawlFields: {
    id: 'h3 a@href',
    link: 'h3 a@href',
    title: 'h3 a | removeNewline | trim',
    address: '.result__list__element__infos--location p | removeNewline | trim',
    // "Wohnung zur Miete", "Haus zum Kauf", "Büros/Praxen", "Garage/Stellplatz/Miete"
    type: '.result__list__element--infos > p | removeNewline | trim',
    image: 'figure img@src',
    // read positionally here and matched by label in normalize, see sortFacts
    label1: '.result__list__element__infos--list li:nth-of-type(1) h4 | trim',
    value1: '.result__list__element__infos--list li:nth-of-type(1) span | trim',
    label2: '.result__list__element__infos--list li:nth-of-type(2) h4 | trim',
    value2: '.result__list__element__infos--list li:nth-of-type(2) span | trim',
    label3: '.result__list__element__infos--list li:nth-of-type(3) h4 | trim',
    value3: '.result__list__element__infos--list li:nth-of-type(3) span | trim',
  },
  getListings,
  normalize,
  fetchDetails,
  activityProbe: checkIfListingIsActive,
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
  name: 'ImmoScout24 Portal',
  baseUrl: BASE_URL,
  id: 'immoscoutPortal',
};

export { config };
