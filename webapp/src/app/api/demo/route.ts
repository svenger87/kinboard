import { NextResponse } from "next/server";

// Surfaces the demo family's join code to the /join page when the
// server has been configured as a public demo. Self-hosters running
// their own household leave KINBOARD_DEMO_FAMILY_CODE unset and the
// /join page renders normally with no banner. Public demos (e.g.
// demo.kinboard.app) set the env var so visitors can see the code
// they should enter to load the seeded household.
//
// Pairs with `webapp/docker/seed-demo.sql` which creates a family
// with join_code = 'DEMO01' (or any value matching this env var).
export async function GET() {
  const code = process.env.KINBOARD_DEMO_FAMILY_CODE?.trim() || null;
  return NextResponse.json({ code });
}
