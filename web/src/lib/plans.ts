export type Plan = "free" | "pro";
export type Currency = "USD" | "INR";

export const MONTHLY_LIMITS: Record<Plan, number> = {
  free: 25,
  pro: 1000,
};

export const PRICES: Record<Currency, { amount: number; label: string }> = {
  USD: { amount: 1200, label: "$12/mo" }, // cents
  INR: { amount: 49900, label: "₹499/mo" }, // paise
};

export function isCurrency(value: unknown): value is Currency {
  return value === "USD" || value === "INR";
}
