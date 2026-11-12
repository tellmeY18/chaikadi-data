# Chaikadi menu library

Volunteer-maintained menus for tea stalls (chaikadis) and small restaurants,
published as static JSON at **https://data.chaikadi.fyi** and used by the
[Chaikadi](https://chaikadi.fyi) app. A group can pick a stall, import its menu
and see how fresh the prices are.

## Licence and sources (please read)

- **Data is public domain.** By contributing you dedicate your menu data to the
  public domain under [CC0-1.0](LICENSE). Code in `scripts/`, `test/` and
  `.github/` is [MIT](LICENSE-CODE).
- **Only data you made yourself.** Write menus from the board, card or bill at
  the place. **Do not paste data copied from Google Maps, Zomato, Swiggy or any
  other platform or website**, and do not copy from other people's photos.
- **OpenStreetMap by ID only.** OSM data is licensed ODbL, which is not
  compatible with CC0. Each place file references an OSM object by its ID
  (`node/123456`) with how it relates to the place (`is`, `inside`, `near`), but **do not copy OSM tags, names from
  OSM, opening hours, addresses or coordinates into this repository.**
- **No personal data.** No contributor names or emails in data files, no phone
  numbers, links, emails or photos. Git history is the only record of who
  contributed; automated commits use the generic `github-actions[bot]` identity.

## Contributing

The easiest way is an issue form: **Add a place**, **Update a menu** or
**Report a problem**. A maintainer reviews it and adds the `accepted` label; a
workflow turns it into a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md)
for pull requests by hand.

## File format (schemaVersion 2)

`places/<country>/<state>/<city>/<place-id>.json`, for example
`places/in/kl/ernakulam/smart-foodie-kitchen-cyber-green.json`. The place id is a
lowercase slug, unique within its city; the app refers to a place as
`<city>/<place-id>`. A trimmed example with every kind of field:

```json
{
  "schemaVersion": 2,
  "id": "smart-foodie-kitchen-cyber-green",
  "name": "Smart Foodie Kitchen",
  "localName": "…",
  "city": "in/kl/ernakulam",
  "kind": "restaurant",
  "osm": { "type": "way", "id": 1292036173, "relation": "inside" },
  "location": { "building": "Prestige Cyber Green, Phase 1", "floor": "Ground floor", "area": "Kakkanad", "postcode": "682042" },
  "currency": "INR",
  "tax": { "included": false, "note": "Prices exclusive of all taxes." },
  "hours": [{ "days": ["mo", "tu", "we", "th", "fr"], "open": "08:00", "close": "19:00" }],
  "note": "…",
  "source": "printed-menu",
  "sections": [
    {
      "id": "lunch",
      "name": "Lunch",
      "hours": [{ "open": "12:00", "close": "16:00" }],
      "sections": [
        {
          "id": "main",
          "name": "Main",
          "items": [
            {
              "id": "chicken-biriyani",
              "name": "Chicken Biriyani",
              "category": "Meal",
              "variants": [
                { "id": "full", "name": "Full", "price": 200 },
                { "id": "half", "name": "Half", "price": 160 }
              ],
              "diet": "non-veg",
              "spice": 2
            },
            { "id": "fish-fry", "name": "Fish Fry", "category": "Meal", "priceStatus": "seasonal", "diet": "non-veg" },
            { "id": "set-dosa", "name": "Set Dosa", "category": "Meal", "price": 60, "portion": "2 pcs" },
            { "id": "grilled-paneer", "name": "Grilled Paneer", "category": "Meal", "price": 50, "addOn": true, "diet": "veg" },
            { "id": "upma", "name": "Upma", "category": "Meal", "price": 60, "uncertain": true, "note": "Name partly illegible." }
          ]
        }
      ]
    }
  ],
  "last_confirmed": "2026-11-12"
}
```

### Place

| Field | Rule |
| --- | --- |
| `schemaVersion` | `2` |
| `id` | lowercase slug ≤ 60, unique in the city; must match the file name |
| `name`, `localName` | 1–80 characters; `localName` in the local script (optional) |
| `city` | `country/state/city` lowercase slug; must match the folder |
| `kind` | `tea-stall`, `cafe`, `restaurant`, `canteen`, `bakery`, `juice-shop`, `food-court-stall`, `hotel`, `other` (optional) |
| `osm` | optional `{ type: node/way/relation, id, relation }`. `is`: the object is the place (only one file may claim it). `inside`: the place is inside it (an office building, a mall). `near`: closest landmark |
| `wikidata` | optional, only if a Wikidata item truly exists |
| `location` | optional `building`, `floor`, `area` (≤ 80 chars) and `postcode`, written by you; never copied from OSM, never coordinates |
| `currency` | ISO 4217, e.g. `INR` |
| `tax` | optional `{ included: true/false, note? }`: whether printed prices include taxes |
| `hours` | optional opening hours: `[{ days?: [mo…su], open: "HH:MM", close: "HH:MM" }]` (close may be earlier than open: past midnight; `24:00` allowed) |
| `note` | optional, ≤ 160 characters |
| `sample` | `true` only for fictional sample data; apps show "Sample" |
| `source` | optional: `in-person`, `printed-menu`, `menu-board` or `bill` |
| `sections` | 1–40 sections |
| `last_confirmed` | ISO date the prices were confirmed; not in the future |

### Sections and items

A section has `id`, `name`, optional `hours` and `note`, and **either** `items`
**or** `sections` (one level of subsections, each with `items`). Section and
item ids are lowercase slugs, unique within the place. At most 300 items per place.

| Item field | Rule |
| --- | --- |
| `id`, `name` | slug unique in the place; 1–80 characters |
| `localName`, `description` | optional; ≤ 80 / ≤ 160 characters |
| `category` | `Tea`, `Coffee`, `Drinks`, `Snacks`, `Meal`, `Dessert` or `Other` |
| `price` | number 0–100000, up to 2 decimals |
| `variants` | instead of `price`: 2–10 `{ id, name, price, portion? }`, e.g. Half / Full |
| `priceStatus` | `market`, `seasonal` or `ask`: required when there is no `price` or `variants` |
| `portion` | e.g. `2 pcs`, `250 ml` |
| `diet` | `veg`, `vegan`, `egg` or `non-veg` (omit when unsure) |
| `spice` | 0–3 |
| `addOn` | `true`: only ordered with something else |
| `available` | `false`: not served at the moment |
| `uncertain` | `true` when the name or price could not be read with confidence; explain in `note` |
| `note` | ≤ 160 characters |

Text anywhere may not contain coordinates, URLs, emails, phone numbers, HTML or
control characters. Files are UTF-8, 2-space indented, keys in canonical order
(the order above), LF line endings and a final newline: run `npm run format`.

The three `sample-*` files under `places/in/kl/ernakulam/` are **fictional**
(`"sample": true`, OSM ids deliberately beyond real ranges) and show every
feature. They cannot be updated through the forms.

### Simple menu JSON

Contributors can paste (issue form) or maintainers can import
(`scripts/import-menu.mjs`) a simpler JSON menu:

```json
{ "restaurant": "…", "currency": "INR", "notes": "Prices exclusive of all taxes.",
  "categories": [
    { "name": "Breakfast", "hours": "08:00-12:00", "subcategories": [
      { "name": "Breads", "items": [{ "name": "Set Dosa", "price": 60, "notes": "2 pcs" }] } ] },
    { "name": "Lunch", "items": [
      { "name": "Chicken Biriyani", "price": 200, "notes": "full" },
      { "name": "Chicken Biriyani", "price": 160, "notes": "half" },
      { "name": "Fish Fry", "price": null, "notes": "seasonal" } ] } ] }
```

It becomes sections with hours; neighbouring same-name items marked
half/full/small/large become variants; notes like `2 pcs`, `add-on`, `seasonal`,
`unavailable` and "illegible" become fields; a tax sentence becomes `tax`.
Categories and diet are inferred only from clear keywords (e.g. Beverages →
Tea/Coffee/Drinks, "chicken" → non-veg); otherwise diet is left out. Review the
result before merging.

## Published files

`npm run build` writes `dist/` (served at https://data.chaikadi.fyi):

| Path | Contents |
| --- | --- |
| `v2/manifest.json` | `schemaVersion: 2`, `generatedAt`, `commit`, `freshness` thresholds, and per city `id`, `name`, `placeCount`, `url` (relative to `v2/`), `sha256`, `bytes` |
| `v2/index/<country>-<state>-<city>.json` | full v2 places of the city (without `city`), plus build-time `status` (`fresh` ≤ 90 days, `stale` ≤ 365, otherwise `unverified`) and `itemCount` |
| `manifest.json`, `index/<city>.json` | **v1 compatibility** for apps released before v2: only places that *are* an OSM object (`osm.relation: "is"`), flat priced items (variants as "Name (Half)", unpriced items left out), five categories |
| `places/<city>/<id>.json` | permalink copy of each place file |
| `places/<city>/<id>.jsonld` | schema.org `Menu` / nested `MenuSection` / `MenuItem` / `Offer` (one per variant) |
| `index.html`, `CNAME`, `.nojekyll`, `_headers` | landing page; Pages configuration; CORS and cache headers for Cloudflare Pages |

Builds are deterministic for a given date and commit: unchanged data gives
identical bundle bytes and hashes. Apps verify each bundle against the
manifest's `sha256`. A bundle over 300 KB fails the build: split the city by
locality (for example `in/kl/ernakulam-kaloor`). Deploys also run weekly so the
build-time freshness status keeps moving.

The files are served with `Access-Control-Allow-Origin: *`, so browsers can
fetch them cross-origin. Check with:

```sh
curl -sI -H "Origin: https://chaikadi.fyi" https://data.chaikadi.fyi/v2/manifest.json | grep -i access-control-allow-origin
```

## Scripts

```sh
npm ci --ignore-scripts      # dev dependencies only: ajv, ajv-formats
npm test                     # node:test suite
npm run validate             # full validation; --changed <base-ref> for PRs
npm run format               # rewrite files in canonical form
npm run build -- --date 2026-11-12   # dist/ (date defaults to today, UTC)
npm run stale-report -- --days 180
node scripts/import-menu.mjs menu.json --city in/kl/ernakulam --date 2026-11-12 \
  --osm way/1292036173 --relation inside --building "…" --area Kakkanad --postcode 682042 --write
```

`validate` prints GitHub Actions annotations (`::error file=…`) in CI and a
readable summary everywhere.

## Workflows

| Workflow | When | Permissions |
| --- | --- | --- |
| `validate.yml` | pull requests | `contents: read` |
| `deploy.yml` | push to `main`, weekly, manual | build: `contents: read`; deploy: `pages: write`, `id-token: write` |
| `stale-report.yml` | weekly, manual | `issues: write` – updates one pinned "Stale menus report" issue |
| `issue-to-pr.yml` | `accepted` label on an add-place / update-menu issue | `contents`, `pull-requests`, `issues: write` |

Third-party actions are pinned to full commit SHAs; Dependabot proposes
updates. Untrusted issue text is never interpolated into shell; no workflow
uses `pull_request_target`.

Pull requests opened by `GITHUB_TOKEN` do not trigger other workflows, so the
`validate` check does not start automatically on bot PRs. A maintainer closes
and reopens the PR (or pushes a commit) to run it. Enable
**Settings → Actions → General → Allow GitHub Actions to create and approve
pull requests** for `issue-to-pr.yml`.

## Recommended branch protection for `main`

Configure in **Settings → Branches** (or rulesets):

- Require a pull request before merging (at least one approval; dismiss stale
  approvals; optionally require review from Code Owners once real owners are set).
- Require status checks to pass: **validate**. Require branches to be up to date.
- Block force pushes and deletions.
- Optionally require linear history and include administrators.
