/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The name to show for one of a job's provider entries.
 *
 * The job form writes the provider's display name onto the entry when the user picks one, but a
 * job created over the API, or one whose provider was renamed since, carries only the id. The
 * loaded provider list knows the current name for that id; the id itself is the last resort, so
 * the row is never blank.
 *
 * @param {{id?: string, name?: string}|null|undefined} entry One of the job's provider entries.
 * @param {Array<{id: string, name: string}>} [providers] The providers the backend offers.
 * @returns {string}
 */
export function providerDisplayName(entry, providers = []) {
  if (entry == null) return '';
  const stored = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (stored.length > 0) return stored;
  const known = Array.isArray(providers) ? providers.find((provider) => provider?.id === entry.id) : null;
  return known?.name ?? entry.id ?? '';
}
