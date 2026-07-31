# Delivery coverage

Restricts ordering to the areas we actually deliver to. Currently **Khartoum
State** — Khartoum, Omdurman and Khartoum North (Bahri).

Coverage is **data, not code**. Adding a city is a seed run; nothing is
hardcoded, nothing needs a deploy, and no app release is involved.

---

## The rule

An address is deliverable when its map pin falls inside an active
`DeliveryZone` polygon. That is the whole rule.

### Why the pin and not the city name

The reverse geocoder returns `"Khartoum"`, `"Khartoum State"`, `"الخرطوم"`,
`"Bahri"` — or, by explicit design in the address flow, **nothing at all**
(`address.model.js`: a pin with no label is still deliverable, and a save is
never blocked on a geocoder outage). A name test would reject real, deliverable
addresses whenever the label came back empty or in the wrong language.

The pin is also the only field the server derives itself and never accepts from
a client, which makes it the only safe thing to gate on.

---

## Where it is enforced

| Layer | Location | Role |
| --- | --- | --- |
| Address save | `controllers/address.controller.js` → `buildAddressPatch` | Early rejection so a shopper isn't asked to fill a form we'll refuse |
| **Checkout** | `services/order.service.js` → `resolveAddress` | **Authoritative.** The gate that actually protects revenue |
| Picker UI | `mobile/app/(screens)/location-picker.tsx` | Greys out Confirm while panning. Feedback only, never a gate |

All three resolve through one module — `services/deliveryArea.service.js` — so
coverage can never mean two different things in two places.

The checkout gate is not redundant with the save gate. An address saved before a
zone existed, or one that fell outside the boundary the last time it was
redrawn, reaches checkout perfectly valid and must still be stopped.

### Fail-open, deliberately

**No active zones means unrestricted, not "reject everything."** An unseeded
collection or a dropped database must never turn into a store that silently
refuses every order in the country. A failed coverage query behaves the same way
and logs loudly.

Coverage is a commercial rule, not a security boundary. Turning an
infrastructure blip into 100% checkout failure is the one unrecoverable outcome
here, so it is designed against.

### Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `OUT_OF_SERVICE_AREA` | 400 | Pin is outside every active zone |
| `ADDRESS_NEEDS_PIN` | 400 | Legacy address with no pin; coverage can't be evaluated |

`ADDRESS_NEEDS_PIN` only fires at checkout, and only once coverage is
configured. A pinless address is exactly the case where "which city is this?"
is least answerable, so it asks the shopper to confirm a location on the map
instead — which also advances the v1 → v2 address migration.

---

## Operations

All commands run from `apps/backend`.

### Turn coverage on

```bash
npm run seed:zones
```

Until this runs, **nothing is enforced**. This is the switch.

### Check without writing

```bash
npm run verify:zones
```

Re-queries MongoDB through the exact `$geoIntersects` the runtime gates use, so
a geometry Mongo silently refuses to index fails here rather than in production
checkout.

### Add a city

```bash
npm run fetch:zone -- "Gezira, Sudan" gezira   # writes scripts/data/zones/gezira.json
# then: remove Wad Madani from scripts/data/excluded-fixtures.json
npm run seed:zones
```

Pass an OSM relation id directly when a place name matches several boundaries:

```bash
npm run fetch:zone -- R3774674 gezira
```

`fetch:zone` only writes to disk. A bad match costs nothing and can be inspected
before it becomes live coverage.

### Remove a city

```bash
rm scripts/data/zones/gezira.json
npm run seed:zones -- --prune
```

Zones are **deactivated, never deleted**, so the geometry and any pricing tuned
against it survive for a later re-enable. Past orders are unaffected either way —
each froze its own address snapshot at checkout.

### Turn coverage off entirely

Deactivate every zone (`isActive: false`). The platform returns to unrestricted
rather than breaking checkout — see *Fail-open* above.

---

## Zone files

`scripts/data/zones/*.json` — one file per area we deliver to. Every file
present is upserted and active.

```jsonc
{
  "name": "Khartoum State",      // unique; the upsert key, and what the app shows
  "nameAr": "ولاية الخرطوم",      // shown to Arabic users
  "cityName": "Khartoum",        // optional City.nameEn, links the legacy hierarchy row
  "priority": 0,                 // higher wins where zones overlap
  "source": "OpenStreetMap relation 3774673 — © OpenStreetMap contributors, ODbL",
  "fixtures": [                  // points that MUST fall inside; verified every run
    { "name": "Omdurman", "lat": 15.6445, "lng": 32.4777 }
  ],
  "geometry": { "type": "MultiPolygon", "coordinates": [/* [lng, lat] */] }
}
```

Coordinates are GeoJSON **[longitude, latitude]** — the single easiest thing to
get backwards.

### The excluded-fixtures pairing

`scripts/data/excluded-fixtures.json` lists places that must **not** be covered.
It is a standing assertion, checked on every seed run.

These two files can contradict each other, and **the seeder refuses to finish
when they do**. Add Gezira but leave Wad Madani in the excluded list and the run
fails with `COVERED by Al Jazirah` rather than seeding a coverage map you didn't
intend.

Editing that file when you add a city isn't bookkeeping — it's the confirmation
that you meant it.

### Redrawing a boundary

OSM gives you the administrative area, which for a state includes a lot of
desert. To trim it — or to carve out somewhere couriers refuse — open the zone
file at [geojson.io](https://geojson.io), redraw `geometry`, and seed that.
Nothing downstream cares where the polygon came from.

---

## Client behaviour

`GET /api/geo/config` carries a `serviceArea` alongside the map config:

```jsonc
{
  "enabled": true,
  "names": ["Khartoum State"],
  "namesAr": ["ولاية الخرطوم"],
  "geometry": { "type": "MultiPolygon", "coordinates": [] },
  "bbox": { "minLat": 15.17, "minLng": 31.70, "maxLat": 16.62, "maxLng": 34.40 }
}
```

The mobile picker tests the pin against this as the shopper pans
(`mobile/services/geo/serviceArea.ts`) and disables Confirm with an
"Outside our delivery area" message.

This is **only** so the shopper fails early instead of after filling in a name,
a phone number and a floor. Anything shipped to a device can be edited; the
server gates are what enforce coverage.

The payload is cached server-side for **5 minutes**, which is also how long a
boundary change takes to reach installs already on phones. Composed in
`geo.controller.js` rather than inside `services/geo/` — coverage is a database
concern and that directory stays vendor- and DB-free.

Search is biased toward the service-area centroid when the client sends no
anchor, so autocomplete stops *offering* Port Sudan. A bias only — the provider
may still return out-of-area places.

---

## Known gaps

- **No admin UI for zones.** Seeding is the only path. `DeliveryZone` already
  carries pricing, ETA and per-merchant fields that nothing reads yet.
- **No deep-link from the checkout error.** `ADDRESS_NEEDS_PIN` surfaces the
  server's message but doesn't jump the shopper into the map picker. Worth
  adding before this ships if many v1 addresses are still in play.
- **Client test is planar** ray casting while the server uses MongoDB's
  spherical `$geoIntersects`. They disagree only within centimetres of a
  boundary, and the server always has the last word.

## Files

```
backend/
  delivery-coverage.md                    ← this file
  scripts/
    fetch-zone.js                         fetch a boundary from OpenStreetMap
    seed-delivery-zones.js                seed / verify / prune
    data/zones/khartoum-state.json        the active boundary
    data/excluded-fixtures.json           places that must stay uncovered
  src/
    services/deliveryArea.service.js      the coverage authority
    models/deliveryZone.model.js          the schema (predates this work)
    controllers/address.controller.js     save gate
    services/order.service.js             checkout gate
    controllers/geo.controller.js         serves the boundary; biases search

mobile/
  services/geo/serviceArea.ts             client-side point-in-polygon
  app/(screens)/location-picker.tsx       out-of-area UI
  __tests__/services/serviceArea.test.ts
```

Boundary data © OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright).
