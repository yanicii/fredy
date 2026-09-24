/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The fork's providers for the NO_RANGE_IN_URL table in test/services/tracking/priceRange.test.js,
 * spread into it so that table stays upstream's.
 */
export const FORK_NO_RANGE_IN_URL = [
  // Groth & Schneider's form has type, marketing type and place, and no price at all.
  ['grothSchneider', 'https://www.grothschneider.de/aktuelle-angebote/?typ%5B%5D=Wohnung&art%5B%5D=Miete'],
  // A portal is addressed by its id; the filters and the sort go through a POST into the session.
  ['immoscoutPortal', 'https://portal.immobilienscout24.de/ergebnisliste/84239610'],
  // Thor's private-rental list is a bare path that takes no parameters whatsoever.
  ['thor', 'https://www.thor.de/privat/list'],
  // Wentzel Dr. keeps every filter inside the frymo_query JSON, so no bound is ever its own param.
  [
    'wentzelDr',
    'https://wentzel-dr.de/immobilien/?frymo_query=%7B%2268389%22%3A%7B%22marketing_type%22%3A%22218%22%2C%22search_string%22%3A%22Hamburg%22%7D%7D',
  ],
];
