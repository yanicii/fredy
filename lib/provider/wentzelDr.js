/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Wentzel Dr., a Hamburg brokerage with listings across northern Germany (Hamburg, Bremen,
 * Hannover, Kiel, Lübeck). Its site is a WordPress install whose listings are rendered by the
 * "Frymo" real estate plugin.
 *
 * The search form on `/immobilien/` never round-trips through the server. Filters are kept in a
 * single `frymo_query` URL parameter holding URL-encoded JSON, and the plugin's JavaScript posts
 * that JSON to WordPress' `admin-ajax.php`, which answers with the rendered listing cards. A plain
 * GET of the search URL therefore always returns the same unfiltered, unsorted first page - which
 * is exactly what a previous scraper of this site silently did. This provider speaks to the AJAX
 * endpoint directly instead, so the filters the user set on the site are honoured and the results
 * can be sorted newest-first and paged.
 *
 * The endpoint wants the Elementor widget's identity (`listing_config`) alongside the query. Those
 * ids are fixed properties of the one search page the site has and are hard-coded here; a query
 * pasted from the site carries the same `query_id` as its key.
 */

import * as cheerio from 'cheerio';
import { isOneOf, buildHash } from '../utils.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
import { extractNumber } from '../utils/extract-number.js';
import { normalizeBuildYear, normalizeEnergyClass } from '../utils/buildingFacts.js';
import { readJsonLdPrice } from '../utils/priceExtractors.js';
import { parse } from '../services/extractor/parser/parser.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://wentzel-dr.de';
const AJAX_ENDPOINT = `${BASE_URL}/wp-admin/admin-ajax.php`;
const SEARCH_PAGE = `${BASE_URL}/immobilien/`;

/**
 * The Elementor listing widget on the search page, as the AJAX handler needs it named. Read off the
 * widget's `data-frymo-widget-settings` attribute; the handler rejects a request that names only
 * the query id with "Invalid data.".
 */
const LISTING_CONFIG = Object.freeze({
  post_id: '3437',
  widget_id: '9351cfd',
  query_id: '68389',
  scrolltop_offset: '100',
});

/**
 * Frymo's sort values read backwards: `date_asc` is labelled "Veröffentlichungsdatum (neueste
 * zuerst)" on the site and does return the newest listings first, `date_desc` the oldest. The
 * pipeline needs newest-first, so whatever order the pasted URL carried is replaced with this.
 */
const NEWEST_FIRST = 'date_asc';

/** The widget renders ten cards per page. Fewer means the last page has been reached. */
const PAGE_SIZE = 10;

/**
 * How many pages to walk per run. A job cares about the newest handful and runs every few
 * minutes; two pages is enough headroom for a batch import between two runs without hammering a
 * small brokerage's WordPress for a hundred cards nobody looks at.
 */
const MAX_PAGES = 2;

const REQUEST_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});

/**
 * The filters a pasted Wentzel search URL carries, ready to be sent to the AJAX endpoint.
 *
 * The site stores them as `?frymo_query={"<query_id>":{...filters}}`. The outer key is whatever id
 * the widget had when the URL was copied - older URLs say `kauf-suche`, current ones `68389` - and
 * the endpoint only reads the entry matching the widget it renders, so the filters are re-keyed
 * under {@link LISTING_CONFIG}'s id. Pagination and ordering are the pipeline's business: a
 * `pagenum` left in a bookmarked URL is dropped and the sort order is forced newest-first.
 *
 * @param {string} url The job's search URL, as pasted from the site.
 * @returns {Record<string, string>} The filters, without paging, sorted newest-first.
 */
export function searchFiltersOf(url) {
  let filters = {};
  try {
    const raw = new URL(url).searchParams.get('frymo_query');
    if (raw) {
      const parsed = JSON.parse(raw);
      const entries = Object.values(parsed ?? {}).filter((value) => value != null && typeof value === 'object');
      filters = Object.assign({}, ...entries);
    }
  } catch (error) {
    logger.warn(`Could not read the Wentzel Dr. search filters from '${url}', searching everything.`, error?.message);
    filters = {};
  }

  delete filters.pagenum;
  filters.order_by = NEWEST_FIRST;
  return filters;
}

/**
 * Ask the listing widget for one page of results.
 *
 * Mirrors the `$.post(frymo.ajaxurl, {action, listing_config, frymo_query})` the site's own script
 * sends: jQuery serialises the nested `listing_config` object PHP-style (`listing_config[post_id]`),
 * and `frymo_query` travels as a JSON string keyed by the widget's query id.
 *
 * @param {Record<string, string>} filters The search filters, see {@link searchFiltersOf}.
 * @param {number} pagenum 1-based page to fetch.
 * @returns {Promise<string|null>} The widget's HTML, or null when the request failed.
 */
export async function fetchListingPage(filters, pagenum) {
  const query = { ...filters };
  if (pagenum > 1) {
    query.pagenum = pagenum;
  }

  const body = new URLSearchParams({ action: 'frymo_render_listing_widget' });
  for (const [key, value] of Object.entries(LISTING_CONFIG)) {
    body.set(`listing_config[${key}]`, value);
  }
  body.set('frymo_query', JSON.stringify({ [LISTING_CONFIG.query_id]: query }));

  const response = await fetch(AJAX_ENDPOINT, {
    method: 'POST',
    headers: {
      ...REQUEST_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: SEARCH_PAGE,
    },
    body,
  });

  if (!response.ok) {
    logger.error(`Error fetching page ${pagenum} from Wentzel Dr.: ${response.status} ${response.statusText}`);
    return null;
  }

  return response.text();
}

/**
 * @param {string} url The job's search URL.
 * @returns {Promise<Object[]>} Raw listing cards, newest first, as the crawl fields read them.
 */
async function getListings(url) {
  const filters = searchFiltersOf(url);
  const listings = [];

  for (let pagenum = 1; pagenum <= MAX_PAGES; pagenum++) {
    const html = await fetchListingPage(filters, pagenum);
    if (html == null) {
      break;
    }

    const page = parse(config.crawlContainer, config.crawlFields, html, url) ?? [];
    listings.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return listings;
}

/**
 * The listing's own JSON-LD block, which the detail page publishes as a `RealEstateListing`.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {any|null}
 */
function readListingJsonLd($) {
  let listing = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (listing != null) return;
    try {
      const data = JSON.parse($(el).text());
      const nodes = Array.isArray(data) ? data : [data];
      listing = nodes.find((node) => node?.['@type'] === 'RealEstateListing') ?? null;
    } catch {
      // ignore malformed JSON-LD
    }
  });
  return listing;
}

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
 * Enrich a listing from its detail page.
 *
 * The search card names only the city. The exposé's JSON-LD adds the postal code, which is what
 * lets the geocoder place the flat in the right district instead of at the centre of Hamburg. The
 * page also carries the full description and the energy data the card lacks entirely.
 *
 * Must always resolve: an exposé that cannot be read leaves the listing as the card described it.
 *
 * @param {ParsedListing} listing
 * @returns {Promise<ParsedListing>}
 */
async function fetchDetails(listing) {
  try {
    const response = await fetch(listing.link, { headers: REQUEST_HEADERS });
    if (!response.ok) {
      logger.warn(`Could not fetch Wentzel Dr. detail page for listing '${listing.id}': ${response.status}`);
      return listing;
    }

    const $ = cheerio.load(await response.text());
    const jsonLd = readListingJsonLd($);

    const postalCode = cleanText(jsonLd?.address?.postalCode);
    const locality = cleanText(jsonLd?.address?.addressLocality) ?? listing.address;
    const address = [postalCode, locality].filter(Boolean).join(' ') || listing.address;

    // The widget text is the full exposé; the JSON-LD description is the same text cut after the
    // first paragraph and ends in "[…]".
    const description =
      cleanText($('.frymo-description .frymo-expandable-content').first().text()) ??
      cleanText($('.frymo-description').first().text()) ??
      cleanText(jsonLd?.description) ??
      listing.description;

    const buildYear = normalizeBuildYear(jsonLd?.about?.yearBuilt?.value);
    const energyClass = normalizeEnergyClass(
      $('.frymo-energy-data-item[data-key="wertklasse"] .frymo-energy-data-value').first().text(),
    );

    return {
      ...listing,
      address,
      description,
      ...(buildYear != null ? { buildYear } : {}),
      ...(energyClass != null ? { energyClass } : {}),
    };
  } catch (error) {
    logger.warn(`Could not fetch Wentzel Dr. detail page for listing '${listing.id}'.`, error?.message || error);
    return listing;
  }
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const link = o.link?.startsWith('http') ? o.link : `${BASE_URL}${o.link ?? ''}`;
  return {
    id: buildHash(o.link, o.price),
    link,
    title: o.title || '',
    price: extractNumber(o.price),
    size: extractNumber(o.size),
    rooms: extractNumber(o.rooms),
    address: o.address,
    image: o.image,
    description: undefined,
  };
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
  crawlContainer: 'article.frymo-listing-item',
  // Sorting lives inside the frymo_query JSON, not in a query parameter; getListings forces it.
  sortByDateParam: null,
  waitForSelector: null,
  crawlFields: {
    id: '.frymo-listing-title a@href',
    link: '.frymo-listing-title a@href',
    title: '.frymo-listing-title a | removeNewline | trim',
    // "713 €" for a Kaltmiete, "349.000 €" for a Kaufpreis; the label sits in a sibling span
    price: '.frymo-listing-price-value | trim',
    size: '.frymo-listing-area .frymo-listing-meta-item-value | trim',
    rooms: '.frymo-listing-rooms .frymo-listing-meta-item-value | trim',
    // the card names the city only; fetchDetails adds the postal code
    address: '.frymo-listing-location | removeNewline | trim',
    image: '.frymo-listing-image img@src',
  },
  getListings,
  normalize,
  fetchDetails,
  activityProbe: checkIfListingIsActive,
  priceTracking: {
    // The exposé's schema.org Offer carries the same figure the card shows as Kaltmiete/Kaufpreis.
    extract: readJsonLdPrice,
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
  name: 'Wentzel Dr.',
  baseUrl: BASE_URL,
  id: 'wentzelDr',
};

export { config };
