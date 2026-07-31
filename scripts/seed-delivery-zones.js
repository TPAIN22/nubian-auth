/**
 * Run with:  npm run seed:zones          (seed / refresh every zone)
 *            npm run verify:zones        (check only, no write)
 *            npm run seed:zones -- --prune   (also deactivate zones no longer on disk)
 *
 * Seeds the platform's delivery coverage from `scripts/data/zones/*.json`.
 * One file per area we deliver to; every file present is upserted and active.
 *
 * Once any active zone exists, `deliveryArea.service.js` starts enforcing
 * coverage at address save and at checkout. An empty zones directory means the
 * platform is unrestricted — deactivating every zone switches the restriction
 * back off rather than breaking checkout.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADDING A CITY
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   1. node scripts/fetch-zone.js "Gezira, Sudan" gezira
 *   2. Remove that city's entry from `scripts/data/excluded-fixtures.json`
 *      if it is listed there (it asserts we do *not* deliver to it).
 *   3. npm run seed:zones
 *
 * That is the whole change: no code edit, no deploy, no app release. The mobile
 * picker re-reads the boundary from `/api/geo/config` within the 5-minute
 * service-area cache, so existing installs pick it up on their own.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REMOVING A CITY
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Delete its file and run with `--prune`, which deactivates (never deletes) any
 * zone with no file behind it. Deactivating preserves the geometry and its
 * pricing, so re-enabling later is a one-line change rather than a re-draw.
 * Orders already placed are unaffected either way — each froze its own address
 * snapshot at checkout.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ZONE FILE FORMAT
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   name      — unique; the upsert key, and what the app shows the shopper
 *   nameAr    — Arabic name, shown to Arabic users
 *   cityName  — optional City.nameEn to link the legacy hierarchy row
 *   priority  — higher wins where zones overlap (a cheap city zone inside a
 *               wider metro one). Defaults to 0.
 *   fixtures  — points that MUST fall inside this zone. Verified on every run.
 *   geometry  — GeoJSON Polygon or MultiPolygon, coordinates as [lng, lat]
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const VERIFY_ONLY = process.argv.includes('--verify');
const PRUNE = process.argv.includes('--prune');

const ZONES_DIR = join(__dirname, 'data/zones');

/** Load and structurally validate every zone file. */
const loadZones = () => {
  const files = readdirSync(ZONES_DIR).filter((f) => f.endsWith('.json'));

  if (!files.length) {
    console.error(`✗ no zone files in ${ZONES_DIR}`);
    console.error('  add one with: node scripts/fetch-zone.js "<place>, Sudan" <slug>');
    process.exit(1);
  }

  return files.map((file) => {
    const zone = JSON.parse(readFileSync(join(ZONES_DIR, file), 'utf-8'));

    const problems = [];
    if (!zone.name) problems.push('missing "name"');
    if (!zone.geometry) problems.push('missing "geometry"');
    else if (!['Polygon', 'MultiPolygon'].includes(zone.geometry.type)) {
      problems.push(`geometry.type must be Polygon or MultiPolygon, got "${zone.geometry.type}"`);
    } else if (!Array.isArray(zone.geometry.coordinates) || !zone.geometry.coordinates.length) {
      problems.push('geometry.coordinates is empty');
    }

    if (problems.length) {
      console.error(`✗ ${file}: ${problems.join('; ')}`);
      process.exit(1);
    }

    return { file, ...zone };
  });
};

const countPoints = (geometry) => {
  const rings =
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  return rings.reduce((sum, ring) => sum + ring.length, 0);
};

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('✗ MONGODB_URI is not set — check apps/backend/.env');
    process.exit(1);
  }

  const zones = loadZones();
  const excluded = JSON.parse(
    readFileSync(join(__dirname, 'data/excluded-fixtures.json'), 'utf-8')
  );

  await mongoose.connect(uri);
  console.log('✓ connected\n');

  // Imported after connect so the models register against this connection.
  const { default: DeliveryZone } = await import('../src/models/deliveryZone.model.js');
  const { default: City } = await import('../src/models/city.model.js');
  const { default: Country } = await import('../src/models/country.model.js');

  if (!VERIFY_ONLY) {
    const country = await Country.findOne({ code: 'SD' }).select('_id').lean();

    for (const zone of zones) {
      // Link back to the legacy hierarchy row seeded by seed-sudan.js where one
      // exists. This is what lets un-pinned legacy addresses be matched to a
      // zone by name later, and why DeliveryZone carries countryId/cityId.
      const city =
        country && zone.cityName
          ? await City.findOne({ countryId: country._id, nameEn: zone.cityName })
              .select('_id')
              .lean()
          : null;

      if (zone.cityName && !city) {
        console.warn(`! ${zone.name}: no City row named "${zone.cityName}" — seeding unlinked`);
      }

      const saved = await DeliveryZone.findOneAndUpdate(
        { name: zone.name },
        {
          $set: {
            nameAr: zone.nameAr || '',
            area: zone.geometry,
            isActive: true,
            merchant: null,
            countryId: country?._id ?? null,
            cityId: city?._id ?? null,
            notes: zone.source || '',
          },
          // Only on insert: never stomp pricing or ETAs tuned in the admin since.
          $setOnInsert: { priority: zone.priority ?? 0 },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      console.log(
        `✓ ${saved.name} — ${countPoints(zone.geometry)} points, active=${saved.isActive}`
      );
    }

    if (PRUNE) {
      const keep = zones.map((z) => z.name);
      const pruned = await DeliveryZone.updateMany(
        { name: { $nin: keep }, isActive: true, merchant: null },
        { $set: { isActive: false } }
      );

      if (pruned.modifiedCount) {
        console.log(`\n✓ deactivated ${pruned.modifiedCount} zone(s) with no file on disk`);
      }
    }
  }

  // ── Verify through the real query path ────────────────────────────────────
  // Deliberately re-queries Mongo rather than testing the JSON in memory: this
  // exercises the 2dsphere index and the exact $geoIntersects the runtime gates
  // use, so a geometry Mongo silently refuses to index fails here rather than in
  // production checkout.
  const coveringZone = (lat, lng) =>
    DeliveryZone.findOne({
      isActive: true,
      area: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } } },
    })
      .sort({ priority: -1 })
      .select('name')
      .lean();

  console.log('\nverifying coverage:');
  let failures = 0;

  for (const zone of zones) {
    for (const fixture of zone.fixtures ?? []) {
      const hit = await coveringZone(fixture.lat, fixture.lng);
      // Any active zone covering it is a pass: overlapping metro zones are a
      // supported arrangement, and priority decides which one prices the order.
      const ok = Boolean(hit);
      if (!ok) failures += 1;

      console.log(
        `  ${ok ? '✓' : '✗'} ${fixture.name.padEnd(26)} expected=in  ` +
          `got=${hit ? hit.name : 'NOT COVERED'}`
      );
    }
  }

  for (const fixture of excluded) {
    const hit = await coveringZone(fixture.lat, fixture.lng);
    const ok = !hit;
    if (!ok) failures += 1;

    console.log(
      `  ${ok ? '✓' : '✗'} ${fixture.name.padEnd(26)} expected=out ` +
        `got=${hit ? `COVERED by ${hit.name}` : 'not covered'}`
    );
  }

  await mongoose.disconnect();

  if (failures) {
    console.error(`\n✗ ${failures} coverage check(s) failed.`);
    console.error('  A city listed in excluded-fixtures.json that you now deliver to');
    console.error('  should be removed from that file — it asserts the opposite.');
    process.exit(1);
  }

  console.log(`\n✓ all coverage checks passed (${zones.length} active zone(s))`);
  if (!VERIFY_ONLY) {
    console.log('  delivery is restricted to these zones at address save and checkout');
  }
};

run().catch(async (error) => {
  console.error('✗ seed failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
