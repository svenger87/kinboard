# Local patches

## pocket-money-all-kids

The stock dashboard pocket-money widget shows one child at a time behind a
toggle. This patch stacks every child balance in the widget, each labeled
with the child name.

- Branch `patch/pocket-money-all-kids` is based on upstream **v1.15.0** (the
  version running on the Beelink) and contains the patched widget source.
- `pocket-money-all-kids.patch` is the same change as a unified diff, for
  re-applying onto a fresh tree after an upstream Kinboard update.
- After updating Kinboard: check out the new release, re-apply this change
  (or cherry-pick the commit), rebuild the webapp image, and restart.
