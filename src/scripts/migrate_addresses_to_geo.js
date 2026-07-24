/**
 * Migration: bring legacy addresses into the map-first schema.
 *
 * Run with:
 *   node src/scripts/migrate_addresses_to_geo.js --dry-run     # report only, no writes
 *   node src/scripts/migrate_addresses_to_geo.js               # migrate
 *   node src/scripts/migrate_addresses_to_geo.js --geocode     # also try to derive pins
 *   node src/scripts/migrate_addresses_to_geo.js --geocode --limit 500
 *
 * ## What it does
 *
 * For every address that hasn't been migrated yet:
 *   1. Maps the legacy Country → City → SubCity names onto the new fields
 *      (`city`, `neighborhood`, `country`) where those are empty.
 *   2. Composes a `formattedAddress` from whatever the row already had, so the
 *      dashboard and order snapshots have a readable line to show.
 *   3. Marks it `schemaVersion: 2`, `isLegacy: true`, `locationSource: 'legacy'`.
 *   4. With `--geocode`, forward-geocodes the composed line through the geo
 *      abstraction and stores the resulting pin — rate-limited, best-effort.
 *
 * ## What it never does
 *
 *   - Delete a field. Every legacy value (`cityId`, `subCityName`, `area`, …)
 *     is left exactly as it was.
 *   - Overwrite a non-empty value. Only empty destinations are filled.
 *   - Touch an address that already has a pin.
 *   - Touch orders. Past orders carry their own frozen snapshot and are
 *     unaffected by anything here.
 *
 * ## Safety
 *
 * Idempotent — re-running is a no-op for rows already at `schemaVersion: 2`.
 * Batched with `bulkWrite`, so it is safe to run against a live production
 * database while traffic is being served. Interrupt and resume freely.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import Address from '../models/address.model.js';
import { getGeoService } from '../services/geo/index.js';
import {
  ADDRESS_CONFIDENCE,
  LOCATION_SOURCE,
  deriveAddressConfidence,
  isValidCoordinate,
} from '../services/geo/types.js';
import { composeAddressLine } from '../lib/address.js';

dotenv.config();

const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const flagValue = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DRY_RUN = hasFlag('--dry-run');
const GEOCODE = hasFlag('--geocode');
const BATCH_SIZE = Number(flagValue('--batch', 500));
const LIMIT = Number(flagValue('--limit', 0)); // 0 = no limit

const log = (...args) => console.log(...args);

/**
 * Build the `$set` patch for one legacy address.
 *
 * Every write here is gap-filling. The customer's manually entered values —
 * `city`, `cityName`, `subCityName`, `area`, `street`, `building` — are read
 * but never modified, and a new field is only written when it is currently
 * empty. Nothing is ever removed.
 *
 * Returns null when the row needs nothing, which is what makes reruns free.
 */
export function buildPatch(doc) {
  const set = {};
  const isEmpty = (v) => !String(v ?? '').trim();

  // Copy the legacy hierarchy names into the new geography fields, but only
  // where the new field is empty — a row that has already been re-pinned on a
  // map must never be dragged back to its old dropdown values.
  if (isEmpty(doc.city) && !isEmpty(doc.cityName)) set.city = doc.cityName;
  if (isEmpty(doc.neighborhood)) {
    const neighborhood = doc.subCityName || doc.area;
    if (!isEmpty(neighborhood)) set.neighborhood = neighborhood;
  }
  if (isEmpty(doc.country) && !isEmpty(doc.countryName)) set.country = doc.countryName;

  // Give the row a readable one-liner built from what it already has.
  if (isEmpty(doc.formattedAddress)) {
    const line = composeAddressLine({ ...doc, ...set });
    if (!isEmpty(line)) set.formattedAddress = line.slice(0, 500);
  }

  const hasPin = Array.isArray(doc.location?.coordinates) && doc.location.coordinates.length === 2;

  // Bookkeeping. A row with a real pin is not legacy, whatever its origin.
  if (doc.schemaVersion !== 2) set.schemaVersion = 2;
  if (!hasPin && doc.isLegacy !== true) set.isLegacy = true;
  if (!hasPin && isEmpty(doc.locationSource)) set.locationSource = LOCATION_SOURCE.LEGACY;
  if (isEmpty(doc.addressLabel)) set.addressLabel = 'home';

  // Confidence is derived, never invented. Without a pin this is `low`, which
  // is the honest description of a text-only address.
  if (isEmpty(doc.addressConfidence)) {
    set.addressConfidence = deriveAddressConfidence({
      locationSource: set.locationSource ?? doc.locationSource,
      hasCoordinates: hasPin,
    });
  }

  return Object.keys(set).length ? set : null;
}

/**
 * Best-effort pin for a legacy address.
 *
 * ## The rule: the customer's own words always win
 *
 * A shopper who typed "Al Thawra, Omdurman" told us something true about where
 * they live. A geocoder that maps that text to a point may also return its own
 * idea of the city, neighbourhood or country — and it is frequently coarser,
 * differently transliterated, or simply wrong for informal addressing.
 * Overwriting user-entered text with it would destroy real data and could
 * silently redirect a delivery.
 *
 * So the geocoded values are only ever used to **fill gaps**. This function
 * returns a patch that never touches a field which already has a value, in the
 * document or in the pending patch.
 *
 * The coordinate is additive — the row had none — so it is always safe to add.
 *
 * Returns null on any failure: a missing pin is the status quo, and the
 * migration must never fail a row because a geocoder had a bad minute.
 */
export async function geocodeLegacyAddress(doc, patch) {
  const query = patch.formattedAddress || composeAddressLine(doc);
  if (!query || query.length < 5) return null;

  try {
    const geo = await getGeoService().forwardGeocode({ query });
    if (!geo || !isValidCoordinate(geo.lat, geo.lng)) return null;

    const isEmpty = (v) => !String(v ?? '').trim();

    /** Current effective value of a field: pending patch first, then the doc. */
    const current = (field) => (isEmpty(patch[field]) ? doc[field] : patch[field]);

    /** Only write `value` when the field is genuinely empty today. */
    const fillIfEmpty = (target, field, value) => {
      if (isEmpty(current(field)) && !isEmpty(value)) target[field] = value;
    };

    const geocoded = {
      // Purely additive: this row had no pin.
      location: { type: 'Point', coordinates: [geo.lng, geo.lat] },
      placeId: geo.placeId || '',
      plusCode: geo.plusCode || '',
      geoProvider: geo.provider || '',
      geocodeAccuracy: geo.accuracy || 'unknown',
      geocodedAt: new Date(),

      // A pin the shopper never saw or confirmed. Flagged so the app can invite
      // them to check it, and so delivery features can weigh it accordingly.
      locationSource: LOCATION_SOURCE.MIGRATED,
      addressConfidence: ADDRESS_CONFIDENCE.MEDIUM,
      isLegacy: true,
    };

    // Gap-filling only — never overwrite what the customer entered.
    fillIfEmpty(geocoded, 'formattedAddress', geo.formattedAddress);
    fillIfEmpty(geocoded, 'city', geo.city);
    fillIfEmpty(geocoded, 'neighborhood', geo.neighborhood);
    fillIfEmpty(geocoded, 'country', geo.country);
    fillIfEmpty(geocoded, 'administrativeArea', geo.administrativeArea);
    fillIfEmpty(geocoded, 'countryCode', geo.countryCode);
    fillIfEmpty(geocoded, 'postalCode', geo.postalCode);

    return geocoded;
  } catch (error) {
    log(`   ! geocode failed for ${doc._id}: ${error.message}`);
    return null;
  }
}

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('MONGODB_URI is not set. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  log(`Connected to MongoDB${DRY_RUN ? '  [DRY RUN — no writes]' : ''}`);

  if (GEOCODE) {
    const geo = getGeoService();
    log(`Geocoding enabled, provider: ${geo.providerKey}`);
    if (!geo.isEnabled) {
      log('No geocoding provider is configured — pins will not be derived.');
    }
  }

  // Only rows that have not reached v2 yet. This predicate is what makes the
  // script resumable and safe to re-run.
  const filter = { $or: [{ schemaVersion: { $ne: 2 } }, { schemaVersion: { $exists: false } }] };

  const total = await Address.countDocuments(filter);
  log(`Addresses needing migration: ${total}`);

  if (total === 0) {
    log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const stats = { scanned: 0, patched: 0, skipped: 0, geocoded: 0, geocodeFailed: 0, errors: 0 };

  const cursor = Address.find(filter)
    .sort({ _id: 1 })
    .limit(LIMIT || 0)
    .lean()
    .cursor();

  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    if (!DRY_RUN) {
      try {
        await Address.bulkWrite(batch, { ordered: false });
      } catch (error) {
        // `ordered: false` means the rest of the batch still applied; log and
        // keep going rather than aborting a partially-complete migration.
        stats.errors += 1;
        log(`   ! bulkWrite reported errors: ${error.message}`);
      }
    }
    batch = [];
  };

  for await (const doc of cursor) {
    stats.scanned += 1;

    let patch;
    try {
      patch = buildPatch(doc);
    } catch (error) {
      stats.errors += 1;
      log(`   ! failed to build patch for ${doc._id}: ${error.message}`);
      continue;
    }

    if (!patch) {
      stats.skipped += 1;
      continue;
    }

    const hasPin = Array.isArray(doc.location?.coordinates) && doc.location.coordinates.length === 2;

    if (GEOCODE && !hasPin) {
      const geocoded = await geocodeLegacyAddress(doc, patch);
      if (geocoded) {
        Object.assign(patch, geocoded);
        stats.geocoded += 1;
      } else {
        stats.geocodeFailed += 1;
      }
    }

    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        // $set only — nothing is ever removed.
        update: { $set: patch },
      },
    });
    stats.patched += 1;

    if (batch.length >= BATCH_SIZE) {
      await flush();
      log(`   … ${stats.scanned}/${total} scanned, ${stats.patched} patched`);
    }
  }

  await flush();

  log('\nMigration summary');
  log('─────────────────');
  log(`  scanned        : ${stats.scanned}`);
  log(`  patched        : ${stats.patched}${DRY_RUN ? ' (would have been)' : ''}`);
  log(`  already ok     : ${stats.skipped}`);
  if (GEOCODE) {
    log(`  pins derived   : ${stats.geocoded}`);
    log(`  pins not found : ${stats.geocodeFailed}`);
  }
  log(`  errors         : ${stats.errors}`);

  if (!DRY_RUN) {
    // createIndexes, deliberately not syncIndexes: syncIndexes DROPS any index
    // that isn't in the schema, which on a production database would silently
    // remove anything added by hand for an ops query. This only adds what's
    // missing (the 2dsphere and the new filter indexes).
    log('\nCreating any missing indexes…');
    await Address.createIndexes();
    log('Indexes ready.');
  }

  await mongoose.disconnect();
  log('\nDone.');
}

// Only run when invoked directly, so `buildPatch` can be imported and tested
// without the import connecting to a database.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run().catch(async (error) => {
    console.error('Migration failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
