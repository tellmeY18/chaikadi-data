# Contributing

Thank you for helping groups order chai with fewer arguments.

## Ground rules

1. **Only data you made yourself.** From the menu board, card or bill at the
   place. Never copy Google Maps, Zomato, Swiggy, other apps, websites or other
   people's photos.
2. **CC0.** You dedicate your contribution to the public domain (see LICENSE).
3. **OSM by ID only.** Look the place up on openstreetmap.org and use its ID
   (`node/123456`). Do not copy OSM tags, addresses or coordinates (ODbL).
   If the place is not on OSM, add it there first following OSM's own rules.
4. **No personal data.** No names, phone numbers, emails, links or photos.
5. **Date honestly.** `last_confirmed` is the day you saw the prices.

## With an issue form (no Git needed)

Choose **Add a place**, **Update a menu** or **Report a problem**. Menu lines are
`name | category | price`; price may be sizes like `Half 160, Full 200` or
`seasonal`, `market`, `ask`; optional columns `veg`, `vegan`, `egg`,
`non-veg`, `add-on`, `unavailable`, a portion like `2 pcs`, or `note: …`.
Group items with `## Section (08:00-12:00)` and `### Subsection` lines, or paste
a simple menu JSON instead (see the README). To remove an item in an update,
write `name | remove`. A maintainer reviews the issue and adds `accepted`; a
bot opens a pull request that closes the issue. If something cannot be
converted, the bot comments with the reasons.

If the place has no OpenStreetMap object of its own (for example a restaurant
inside an office building), link the building and choose *The place is inside
this building or site*.

## With a pull request

```sh
npm ci --ignore-scripts
# create or edit places/<country>/<state>/<city>/<place-id>.json
# or: node scripts/import-menu.mjs menu.json --city … --date … --write
npm run format
npm run validate
npm test
```

Fill in the pull request checklist. Keep one place per pull request when you can.

## Maintainers

- Labels used by automation: `add-place`, `update-menu`, `problem`, `accepted`,
  `stale-report`. Create them once (see the setup commands in the app repo
  docs or run `gh label create <name>`).
- Only add `accepted` after checking that the submission looks first-hand and
  contains no copied or personal data.
- Bot pull requests do not start `validate` automatically; close and reopen the
  pull request to run it before merging.
- Remove anything reported as copied or personal promptly, including from the
  history if necessary.
