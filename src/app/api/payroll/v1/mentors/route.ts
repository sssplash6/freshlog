import { mentorsResponse, payrollJson, payrollRefusal } from "@/lib/payroll-api/server";

// Read fresh on every call, like the hours route beside it.
export const dynamic = "force-dynamic";

/**
 * Every mentor with a rate: today's rate, when pay started, and their payable
 * minutes, for FreshWeek's payroll (src/lib/payroll-api/contract.ts).
 * Server to server, on PAYROLL_API_SECRET.
 */
export async function GET(request: Request) {
  const refused = payrollRefusal(request);
  if (refused) return refused;
  return payrollJson(await mentorsResponse());
}
