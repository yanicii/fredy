/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Erich Thor Wohnungsunternehmen, a Hamburg landlord letting its own flats without an agent.
 *
 * `/privat/list` is one short page with every flat on offer. Its filter form posts, so the URL
 * carries no filters; a job simply reads the whole list. Each card is one run of text - headline,
 * features, address, rent, availability and energy data all in a single block - so the facts are
 * read with patterns rather than selectors. The "mehr Infos" link leads off-site to Immomio, the
 * application platform the landlord uses, and there is no exposé of its own to enrich from: the
 * card already carries the build year and the efficiency class.
 *
 * The rent on the card is the *inclusive* rent ("Miete inkl."), i.e. warm, not the Kaltmiete the
 * other providers report. There is no cold rent anywhere on the site.
 */

import { isOneOf, buildHash } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import { normalizeBuildYear, normalizeEnergyClass } from '../utils/buildingFacts.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://www.thor.de';

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
 * Pull the facts out of a card's text block.
 *
 * A card reads like `2-Zimmer Wohnung in Norderstedt, 62,48 m², 5. Etage, Küche, … Gleiwitzer
 * Kehre 4, 22850 Norderstedt Miete inkl. EUR 973,00, Kaution frei ab 01.10.2026
 * Energieverbrauchsausweis, Kennwert 127,4 kWh / (m² * a), Fernwärme, Bj. 1965,
 * Energieeffizienzklasse D`. The headline is everything before the first comma.
 *
 * @param {string|null|undefined} text The card's text, whitespace already collapsed.
 * @returns {{title: string|null, rooms: number|null, size: number|null, price: number|null, buildYear: number|null, energyClass: string|null}}
 */
export function parseCard(text) {
  const clean = cleanText(text) ?? '';
  return {
    title: cleanText(clean.split(',')[0]),
    rooms: extractNumber(clean.match(/([\d,.]+)-Zimmer/)?.[1]),
    size: extractNumber(clean.match(/([\d.]+,?\d*)\s*m²/)?.[1]),
    price: extractNumber(clean.match(/EUR\s*([\d.]+,?\d*)/)?.[1]),
    buildYear: normalizeBuildYear(clean.match(/Bj\.\s*(\d{4})/)?.[1]),
    energyClass: normalizeEnergyClass(clean.match(/Energieeffizienzklasse\s*([A-H]\+*)/)?.[1]),
  };
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const facts = parseCard(o.text);
  // The application id on Immomio is the only stable identifier a card has.
  const applyId = o.link?.match(/\/apply\/([a-f0-9-]+)/i)?.[1] ?? o.link;
  return {
    // buildHash drops anything without a length, so the rent goes in as text
    id: buildHash(applyId, facts.price == null ? null : String(facts.price)),
    link: o.link,
    title: facts.title ?? '',
    price: facts.price,
    size: facts.size,
    rooms: facts.rooms,
    address: cleanText(o.address),
    image: o.image ? new URL(o.image, BASE_URL).toString() : null,
    description: cleanText(o.text),
    ...(facts.buildYear != null ? { buildYear: facts.buildYear } : {}),
    ...(facts.energyClass != null ? { energyClass: facts.energyClass } : {}),
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
  // the last "card" is a registration teaser without a link; the parser drops it for want of an id
  crawlContainer: '.row.listobj',
  sortByDateParam: null,
  waitForSelector: null,
  crawlFields: {
    id: 'a[href*="immomio.com/de/apply"]@href',
    link: 'a[href*="immomio.com/de/apply"]@href',
    text: '.list-desc-text | removeNewline | trim',
    address: '.list-desc-text strong | removeNewline | trim',
    image: 'img.list-image@src',
  },
  normalize,
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
  name: 'Thor',
  baseUrl: BASE_URL,
  id: 'thor',
};

export { config };
