import { randomBytes } from "crypto";
import { ReferralHistoryTable } from "../../db/schema.ts";

/**
 * Generate a referral code string
 * Format: PREFIX-XXXXXX
 * - Operator: OP-ABC123
 * - Rep1: R1-XYZ789
 * - Rep2: R2-QWE456
 * - Player: PL-XXX...
 */
export function generateReferralCode(type: "operator" | "rep1" | "rep2" | "player") {
  const prefixMap: Record<string, string> = {
    operator: "OP",
    rep1: "R1",
    rep2: "R2",
    player: "PL",
  };

  const prefix = prefixMap[type] || "XX";
  const randomPart = randomBytes(4).toString("hex").toUpperCase(); // 8-char hex

  return `${prefix}-${randomPart}`;
}

export async function logReferralHistory(
  db: any,
  {
    referralId,
    action,
    userId,
    details,
  }: {
    referralId: number;
    action: string;
    userId: number;
    details?: string;
  }
) {
  await db.insert(ReferralHistoryTable).values({
    referralId,
    action,
    userId,
    details,
    createdAt: new Date(),
  });
}
