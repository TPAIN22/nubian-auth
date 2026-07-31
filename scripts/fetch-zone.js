/**
 * Run with:  node scripts/fetch-zone.js "<place>" <slug> [--city <City.nameEn>]
 *
 * Examples:
 *   node scripts/fetch-zone.js "Gezira, Sudan" gezira
 *   node scripts/fetch-zone.js "Port Sudan, Sudan" port-sudan --city "Red Sea"
 *   node scripts/fetch-zone.js "R3774673" khartoum-state      (OSM relation id)
 *
 * Fetches an administrative boundary from OpenStreetMap and writes it as a zone
 * file in `scripts/data/zones/`. Run `npm run seed:zones` afterwards to push it
 * to the database — this script only writes to disk, so a bad match costs
 * nothing and can be inspected before it becomes live coverage.
 *
 * The boundary is whatever OSM calls that place. When that is the wrong shape —
 * too much desert, an area couriers refuse — open the written file at
 * geojson.io, redraw `geometry`, and seed that instead. Nothing downstream
 * cares where the polygon came from.
 *
 * Data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ZONES_DIR = join(__dirname, 'data/zones');

// Nominatim's usage policy requires an identifying UA with a contact address.
const USER_AGENT =
  process.env.GEO_USER_AGENT || 'nubian-platform-zone-seed/1.0 (ops@nubian.local)';

const args = process.argv.slice(2);
const flagIndex = args.indexOf('--city');
const cityName = flagIndex !== -1 ? args[flagIndex + 1] : null;
// `flagIndex + 1` is only a flag *value* when the flag is actually present —
// otherwise it is 0, which would swallow the query argument.
const cityValueIndex = flagIndex === -1 ? -1 : flagIndex + 1;
const positional = args.filter((a, i) => !a.startsWith('--') && i !== cityValueIndex);

const [query, slug] = positional;

if (!query || !slug) {
  console.error('usage: node scripts/fetch-zone.js "<place>" <slug> [--city <City.nameEn>]');
  console.error('   eg: node scripts/fetch-zone.js "Gezira, Sudan" gezira');
  process.exit(1);
}

const request = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`OpenStreetMap responded ${res.status}`);
  return res.json();
};

/** Round to ~1 m. The full precision is noise we'd otherwise ship to every app. */
const round = (n) => Math.round(n * 1e5) / 1e5;

const simplifyRing = (ring) => {
  const out = [];
  for (const [lng, lat] of ring) {
    const point = [round(lng), round(lat)];
    // Rounding can collapse neighbouring points onto each other.
    const last = out[out.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  // GeoJSON requires a closed ring; Mongo rejects an open one at index time.
  const [first] = out;
  const lastPoint = out[out.length - 1];
  if (first && lastPoint && (first[0] !== lastPoint[0] || first[1] !== lastPoint[1])) {
    out.push([first[0], first[1]]);
  }
  return out;
};

/** Normalise Polygon | MultiPolygon into a MultiPolygon, so zone files are uniform. */
const toMultiPolygon = (geometry) => {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

  return {
    type: 'MultiPolygon',
    coordinates: polygons.map((polygon) => polygon.map(simplifyRing)),
  };
};

const run = async () => {
  // An "R<id>" argument is an exact OSM relation; anything else is a search.
  const isRelationId = /^R\d+$/i.test(query);

  // `namedetails=1` returns the per-language name tags, so both the English and
  // Arabic names come straight from OSM instead of whichever one the API
  // happens to consider local — for Sudan that is Arabic, which would otherwise
  // land in `name` and leave `nameAr` empty, exactly backwards.
  const common = 'format=json&polygon_geojson=1&namedetails=1&accept-language=en';

  const url = isRelationId
    ? `https://nominatim.openstreetmap.org/lookup?osm_ids=${encodeURIComponent(
        query.toUpperCase()
      )}&${common}`
    : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        query
      )}&limit=5&featureType=settlement&${common}`;

  console.log(`→ looking up "${query}" …`);
  const results = await request(url);

  if (!results.length) {
    console.error(`✗ no match for "${query}"`);
    console.error('  try a more specific query, or pass an OSM relation id like R3774673');
    process.exit(1);
  }

  // Only a boundary has an area to deliver inside; a point result is useless here.
  const usable = results.filter(
    (r) => r.geojson && ['Polygon', 'MultiPolygon'].includes(r.geojson.type)
  );

  if (!usable.length) {
    console.error(`✗ "${query}" matched, but with no boundary polygon`);
    console.error('  matches were:');
    for (const r of results) {
      console.error(`    ${r.osm_type} ${r.osm_id} — ${r.display_name} (${r.geojson?.type})`);
    }
    console.error('  find the administrative relation on openstreetmap.org and pass its id.');
    process.exit(1);
  }

  if (usable.length > 1) {
    console.log(`  ${usable.length} boundaries matched, using the first:`);
    for (const [i, r] of usable.entries()) {
      console.log(`    ${i === 0 ? '→' : ' '} R${r.osm_id} — ${r.display_name}`);
    }
    console.log('  pass an explicit relation id (R<id>) if that is the wrong one.');
  }

  const match = usable[0];
  const geometry = toMultiPolygon(match.geojson);
  const points = geometry.coordinates.reduce(
    (sum, polygon) => sum + polygon.reduce((s, ring) => s + ring.length, 0),
    0
  );

  const [south, north, west, east] = (match.boundingbox ?? []).map(Number);
  const centre =
    Number.isFinite(south) && Number.isFinite(west)
      ? { lat: (south + north) / 2, lng: (west + east) / 2 }
      : null;

  const names = match.namedetails ?? {};

  const zone = {
    name: names['name:en'] || match.name || match.display_name.split(',')[0].trim(),
    nameAr: names['name:ar'] || '',
    ...(cityName ? { cityName } : {}),
    priority: 0,
    source: `OpenStreetMap relation ${match.osm_id} — © OpenStreetMap contributors, ODbL`,
    fetchedAt: new Date().toISOString().slice(0, 10),
    note: match.display_name,
    // A starting fixture so `npm run seed:zones` verifies this zone from the
    // first run. Replace it with real landmarks you know are deliverable — the
    // centre of a bounding box can land in open desert.
    fixtures: centre ? [{ name: `${names['name:en'] || match.name} centre`, ...centre }] : [],
    geometry,
  };

  if (!existsSync(ZONES_DIR)) mkdirSync(ZONES_DIR, { recursive: true });

  const target = join(ZONES_DIR, `${slug}.json`);
  if (existsSync(target)) {
    console.log(`! ${slug}.json exists — overwriting its geometry`);
  }

  writeFileSync(target, JSON.stringify(zone, null, 2), 'utf-8');

  console.log(`\n✓ wrote scripts/data/zones/${slug}.json`);
  console.log(`  name:   ${zone.name}${zone.nameAr ? `  /  ${zone.nameAr}` : ''}`);
  console.log(`  source: ${zone.source}`);
  console.log(`  ${points} points, ${geometry.coordinates.length} polygon(s)`);

  console.log('\nnext:');
  const steps = [];
  if (!zone.nameAr) steps.push('set "nameAr" — Arabic users are shown that name');
  steps.push('replace "fixtures" with landmarks you know we deliver to');
  steps.push('remove this city from scripts/data/excluded-fixtures.json if listed there');
  steps.push('npm run seed:zones');
  steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
};

run().catch((error) => {
  console.error('✗ fetch failed:', error.message);
  process.exit(1);
});
