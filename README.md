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
  (`node/123456`) so apps can link to it, but **do not copy OSM tags, names from
  OSM, opening hours, addresses or coordinates into this repository.**
- **No personal data.** No contributor names or emails in data files, no phone
  numbers, links, emails or photos. Git history is the only record of who
  contributed; automated commits use the generic `github-actions[bot]` identity.

## Contributing

The easiest way is an issue form: **Add a place**, **Update a menu** or
**Report a problem**. A maintainer reviews it and adds the `accepted` label; a
workflow turns it into a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md)
for pull requests by hand.

## File format (schemaVersion 1)

`places/<country>/<state>/<city>/<osm-type>-<osm-id>.json`, for example
`places/in/kl/ernakulam/node-123456.json`:

```json
{
  "schemaVersion": 1,
  "id": "node/123456",
  "name": "Kadavanthra Chaikadi",
  "city": "in/kl/ernakulam",
  "currency": "INR",
  "menu": [
    {
      "id": "chai",
      "name": "Chai",
      "category": "Tea",
      "price": 12,
      "veg": true,
      "available": true
    }
  ],
  "last_confirmed": "2026-11-12"
}
```

| Field | Rule |
| --- | --- |
| `id` | `node`, `way` or `relation` / OSM number; must match the file name |
| `name` | 1–80 characters |
| `city` | `country/state/city` lowercase slug; must match the folder |
| `currency` | ISO 4217, e.g. `INR` |
| `wikidata` | optional, only if a Wikidata item truly exists |
| `sample` | optional `true` for fictional sample data; apps show "Sample" |
| `menu` | 1–150 items; `id` lowercase slug unique in the place |
| `category` | `Tea`, `Coffee`, `Snacks`, `Meal` or `Other` |
| `price` | number 0–10000, up to 2 decimals |
| `veg`, `available` | optional booleans |
| `last_confirmed` | ISO date the prices were confirmed; not in the future |

Text may not contain coordinates, URLs, emails, phone numbers, HTML or control
characters. Files are UTF-8, 2-space indented, keys in canonical order (the
order above), LF line endings and a final newline: run `npm run format`.

The three files under `places/in/kl/ernakulam/` with IDs `9000000000001`–`3`
are **fictional samples** (`"sample": true`) for testing; those IDs are
deliberately beyond real OSM ranges. They cannot be updated through the forms.

## Published files

`npm run build` writes `dist/` (deployed to GitHub Pages at data.chaikadi.fyi):

| Path | Contents |
| --- | --- |
| `manifest.json` | `schemaVersion`, `generatedAt`, `commit`, `freshness` thresholds, and per city `id`, `name`, `placeCount`, `url` (relative), `sha256`, `bytes` |
| `index/<country>-<state>-<city>.json` | city bundle: every place with `status` (`fresh` ≤ 90 days, `stale` ≤ 365, otherwise `unverified`, computed at build time), `itemCount` and `menu` |
| `places/…/<type>-<id>.json` | permalink copy of each place file |
| `places/…/<type>-<id>.jsonld` | schema.org `Menu` / `MenuSection` / `MenuItem` / `Offer` export |
| `index.html`, `CNAME`, `.nojekyll` | landing page and Pages configuration |

Builds are deterministic for a given date and commit: unchanged data gives
identical bundle bytes and hashes. Apps verify each bundle against the
manifest's `sha256`. A bundle over 300 KB fails the build: split the city by
locality (for example `in/kl/ernakulam-kaloor`). Deploys also run weekly so the
build-time freshness status keeps moving.

GitHub Pages sends `Access-Control-Allow-Origin: *`, so browsers can fetch the
files cross-origin. Check with:

```sh
curl -sI -H "Origin: https://chaikadi.fyi" https://data.chaikadi.fyi/manifest.json | grep -i access-control-allow-origin
```

## Scripts

```sh
npm ci --ignore-scripts      # dev dependencies only: ajv, ajv-formats
npm test                     # node:test suite
npm run validate             # full validation; --changed <base-ref> for PRs
npm run format               # rewrite files in canonical form
npm run build -- --date 2026-11-12   # dist/ (date defaults to today, UTC)
npm run stale-report -- --days 180
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
