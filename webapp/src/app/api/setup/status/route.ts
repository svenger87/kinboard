import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Returns whether any families exist in the database. Used by the join
 * page to detect a fresh install and steer the user to "Create family"
 * mode instead of asking for a join code that doesn't exist yet.
 *
 * Public endpoint by design — leaks only a single boolean.
 */
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("families")
      .select("id", { count: "exact", head: true });

    if (error) {
      console.error("setup/status: failed to count families:", error);
      return NextResponse.json({ hasFamilies: true }, { status: 200 });
    }

    return NextResponse.json({ hasFamilies: (count ?? 0) > 0 });
  } catch (err) {
    console.error("setup/status: unexpected error:", err);
    return NextResponse.json({ hasFamilies: true }, { status: 200 });
  }
}
