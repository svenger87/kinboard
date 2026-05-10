import { NextResponse } from "next/server";
import catalog from "@/plugins/pocket-money/catalog/avatars.json";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(catalog);
}
