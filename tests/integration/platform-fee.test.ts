import { describe, expect, test } from "vitest";
import { calculatePlatformFee, isBelowPaidMinimum, minPaidPrice } from "@/lib/stripe/fees";

// T46: 3.75% of the order, rounded once, plus $0.89 per ticket (a membership or
// merchandise order counts as one), never more than the price.
describe("platform fee", () => {
  test("matches the examples on the Fees page and never exceeds the price", () => {
    expect([calculatePlatformFee(500), calculatePlatformFee(2400, 2), calculatePlatformFee(2500), calculatePlatformFee(5500)]).toEqual([108, 268, 183, 295]);
    expect(calculatePlatformFee(3000)).toBe(202);
    expect(calculatePlatformFee(50)).toBe(50);
    // At the $2.00 paid minimum the society keeps more than half: fee 97c, society $1.03.
    expect(calculatePlatformFee(minPaidPrice)).toBe(97);
    expect(minPaidPrice - calculatePlatformFee(minPaidPrice)).toBeGreaterThan(minPaidPrice / 2);
    expect([isBelowPaidMinimum(0), isBelowPaidMinimum(199), isBelowPaidMinimum(200)]).toEqual([false, true, false]);
    expect(() => calculatePlatformFee(0)).toThrow();
    expect(() => calculatePlatformFee(1000, 0)).toThrow();
  });
});
