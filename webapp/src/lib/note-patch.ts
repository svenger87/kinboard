/**
 * What a PATCH on a note should write — decided once so the route and its
 * tests share the same rule (RFC-011 task 3), the same split
 * `task-completion.ts` made for task completion.
 *
 * A note's writable surface is two fields: `content` (trimmed, 1–2000
 * characters — the same bound `create_note` already enforces) and `pinned`
 * (a plain boolean). Either, both, or neither key may be present in the
 * body; "neither" is refused, matching `/lists/{list}/{item}`'s "nothing to
 * change" rule, so a caller cannot send an empty patch and get a false `ok`.
 *
 * `updated_at` is deliberately not part of this function's output: the
 * `update_notes_updated_at` trigger (`docker/init.sql`) stamps it on every
 * UPDATE, so the route never writes it itself.
 */

const MAX_CONTENT = 2000;

export interface NotePatchOk {
  ok: true;
  patch: Record<string, unknown>;
}

export interface NotePatchError {
  ok: false;
  error: string;
}

export function notePatch(body: Record<string, unknown>): NotePatchOk | NotePatchError {
  const patch: Record<string, unknown> = {};

  if ("content" in body) {
    const value = body.content;
    if (typeof value !== "string") {
      return { ok: false, error: "`content` must be a string" };
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CONTENT) {
      return { ok: false, error: `\`content\` must be 1–${MAX_CONTENT} characters` };
    }
    patch.content = trimmed;
  }

  if ("pinned" in body) {
    const value = body.pinned;
    if (typeof value !== "boolean") {
      return { ok: false, error: "`pinned` must be a boolean" };
    }
    patch.pinned = value;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "nothing to change — send content or pinned" };
  }

  return { ok: true, patch };
}
