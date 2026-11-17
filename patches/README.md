# Local patches

## pocket-money-all-kids (v2)

The stock dashboard pocket-money widget shows one child at a time behind a
toggle. This patch makes the layout a widget setting and adds an optional
recent-transactions list.

**Settings -> Widgets -> Pocket Money** (stored per family under the
`pocket_money_widget` settings key):

- **Display**: `Toggle` (stock switcher), `All children` (every child
  stacked in one card, the default), or `One widget per child` (the
  dashboard renders a separate card per child, the same pattern as the
  schedule widget per-child option).
- **Recent transactions per child**: Off / 3 / 5 / 10 (default 3). Each
  child block lists its latest transactions with note or type, date, and
  signed amount.

Branch `patch/pocket-money-all-kids` is based on upstream **v1.15.0** (the
version running on the Beelink). Files touched, all under `webapp/`:

- `src/components/widgets/pocket-money-widget.tsx` (modes + transactions)
- `src/app/page.tsx` (per-child cards on the dashboard)
- `src/app/settings/widgets/page.tsx` (the settings controls)
- `src/types/widgets.ts` + `src/lib/settings-keys.ts` (setting shape + key)
- `messages/{en,de,fr}.json` (labels; de/fr currently carry English text)

`pocket-money-all-kids.patch` in this folder is the same change as one
unified diff against the v1.15.0 tree. After an upstream Kinboard update:
check out the new release, re-apply (branch or patch), rebuild the webapp
image, restart.
