/**
 * Helper utilities for store currency formatting and symbol resolution
 */

export function formatCurrency(amount, currencyCode = "USD") {
  const num = typeof amount === "string" ? parseFloat(amount) || 0 : (amount || 0);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits: num % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch (e) {
    return `${currencyCode || "USD"} ${num.toFixed(2)}`;
  }
}

export function getCurrencySymbol(currencyCode = "USD") {
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
    }).formatToParts(0);
    const symbolPart = formatted.find((p) => p.type === "currency");
    return symbolPart ? symbolPart.value : (currencyCode || "$");
  } catch (e) {
    return currencyCode || "$";
  }
}
