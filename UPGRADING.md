# Upgrading Kinboard

Most upgrades need nothing from you: pull the new image, restart, and the
entrypoint applies any new database migrations on boot.

The releases below are the exceptions.

---

## 1.6.0 — row-level security (**every device must re-join**)

**Before you upgrade, write down your family join code.** Settings → Family, or
see [Recovering a lost join code](#recovering-a-lost-join-code) if you have
already upgraded.

### What changes

Kinboard's browser client talks to PostgREST directly. Until 1.6.0, row-level
security was disabled and every query was filtered in application code
instead — which works, right up until the instance is reachable from outside
your network. The anon key ships in the browser bundle, so with RLS off anyone
who could reach the API could read and write every table, including the one
holding join codes.

From 1.6.0 the database enforces isolation itself:

- a device joins with the family code and gets a server-issued, HttpOnly
  session cookie;
- that cookie is exchanged at `/api/session/token` for a short-lived token
  carrying a `family_id` claim;
- every row-level security policy resolves the caller's family from that claim.

The old `family-calendar-storage` cookie was never a credential — it was the
client's own state, written by JavaScript, unsigned, and never checked by the
server. It is not upgraded to a session, deliberately: honouring it would mean
honouring anything a browser chose to write.

### What you will see

After the upgrade every device shows the join screen. Nothing is lost — the
data is all there, and each device just needs the family code entered once.

Do the kiosk first if you have one, since it is the one that needs someone
standing in front of it.

### Recovering a lost join code

The join code lives in Settings, which you cannot reach while logged out. If
you upgraded without noting it down:

```bash
docker exec kinboard-db psql -U postgres -d postgres \
  -c "SELECT name, join_code FROM public.families;"
```

Adjust the container name if you changed `PROJECT_NAME`. This works because
`psql` connects as a superuser, which bypasses row-level security.

### If you publish Kinboard to the internet

This release is what makes that defensible. Before it, publishing the stack
meant publishing your data — the `/rest`, `/auth`, `/storage` and `/realtime`
paths all reach Supabase with the public anon key.

Verify it yourself after upgrading, from a machine outside your network:

```bash
curl -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  "https://your-kinboard.example/rest/v1/families?select=id,name,join_code"
```

An upgraded instance returns `[]`. Anything else means the migration did not
apply — check the webapp container logs on boot.

### Requirements

`JWT_SECRET` must reach the **webapp** container, not only Kong, GoTrue and
PostgREST. It is what signs the family-scoped tokens, and it must be the same
secret PostgREST verifies with. `setup.sh` and the bundled compose file handle
this; if you maintain your own compose file, add it:

```yaml
  webapp:
    environment:
      JWT_SECRET: ${JWT_SECRET}
```

Without it, joining still works but no data loads — the app cannot mint a token
the database will accept.

### Rolling back

If something goes wrong, RLS can be turned off again to restore the previous
behaviour:

```bash
docker exec kinboard-db psql -U postgres -d postgres -c "
DO \$\$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t); END LOOP;
END \$\$;"
```

This restores service immediately, and restores the exposure with it. Treat it
as a way to buy time, not a resting state — and do not publish the instance
while it is in that state.

Note that the next boot re-applies the migration, so a rollback lasts until you
restart. That is deliberate.
