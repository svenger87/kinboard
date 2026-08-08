# Recycle bin

**Settings → Recycle bin.** Anything deleted goes here first and can be put back.

This exists because of a specific failure. A child tapped delete on a birthday on the wall tablet, nobody noticed for weeks, and by the time anyone did the only way back was a maintainer diffing three-month-old database dumps. A wall display is touched by everyone in the house, including the people least likely to read a confirmation dialog — so deletion has to be recoverable, not just guarded.

## What it covers

| Deleted from | Lands in the bin |
| --- | --- |
| Birthdays, and their gift ideas | yes |
| Notes | yes |
| Tasks / todos | yes |
| School subjects | yes |
| Meal plan entries | yes |
| Recipes | yes |
| Pocket-money savings goals | yes |
| People (family members) | yes |
| **Calendar events** | **no** |

Calendar events are deliberately excluded. They are reconciled against the upstream calendar — Google, CalDAV or an ICS feed — on every sync, so a "deleted" event either reappears on the next run or fights the syncer. Deleting an event belongs in the source calendar, and it has its own history there.

Configuration is also out of scope: settings, devices, calendar connections, integration credentials. Recreating those is setup, not lost data.

## Restoring

Open **Settings → Recycle bin**, find the entry, tap **Restore**. It reappears wherever it was, with its original date and content.

Restoring is whole. Deleting a person does not really delete their schedule entries or pocket-money account — those are held back too, and come back with the person. Same for a recipe and its ingredients. Nothing has to be reassembled by hand.

The bin is behind the settings PIN, like everything else under `/settings`. If you have a PIN set, a child cannot empty the bin they just filled.

## Deleting for good

Each entry also has a **Delete permanently** action, with its own confirmation. That one really is final — it removes the item and everything that belonged to it.

## Retention window

At the top of the page: **7 days**, **30 days** (default), **90 days**, or **Forever**.

A nightly job at 03:30 removes anything that has been in the bin longer than the window. Set it to **Forever** and nothing is ever removed automatically; you then empty the bin yourself, which is the right setting if you would rather trade disk for certainty.

The window applies per family and takes effect at the next nightly run, so widening it does not bring back what has already gone.

## Under the hood

Worth knowing if you self-host and go poking at the database:

- Deletion is implemented in Postgres, not in the app. A `BEFORE DELETE` trigger stamps `deleted_at` and cancels the delete, and `deleted_at IS NULL` is appended to each table's row-level-security policy. Every existing delete became a soft delete and every existing query hides binned rows, without a single call site changing.
- Cancelling the delete also cancels its `ON DELETE CASCADE`. That is what makes restore whole.
- Purging is the reverse and has to be, which is why it runs through the `purge_deleted()` / `purge_expired()` functions rather than a plain `DELETE`: they set `kinboard.hard_delete` for the transaction so every trigger stands down at once, cascades included. A plain delete would leave the cascaded children behind, pointing at a parent that no longer exists.
- The retention window lives in `settings` under the key `recycle_bin`, as `{"retentionDays": 30}`.

See also: [[Architecture]] for the schema and RLS model, [[Birthdays]], [[Notes]], [[Tasks]].
