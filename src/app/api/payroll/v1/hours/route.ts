import type { NextRequest } from "next/server";

import { hoursResponse, payrollJson, payrollRefusal } from "@/lib/payroll-api/server";

// Every answer is read fresh: FreshWeek freezes what it is sent, so a cached
// figure would be frozen into somebody's pay.
export const dynamic = "force-dynamic";

/**
 * One mentor's rates and payable sessions, for FreshWeek's payroll
 * (src/lib/payroll-api/contract.ts). Server to server, on PAYROLL_API_SECRET —
 * not a signed-in route, and not the app's /api/v1.
 */
export async function GET(request: NextRequest) {
  const refused = payrollRefusal(request);
  if (refused) return refused;

  const email = request.nextUrl.searchParams.get("email")?.trim();
  if (!email) return payrollJson({ error: "Pass ?email=." }, 400);

  return payrollJson(await hoursResponse(email));
}
