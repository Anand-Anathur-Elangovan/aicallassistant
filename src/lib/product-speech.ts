/** Strip SKU / model codes from product text for spoken replies. */
export function humanizeProductText(text: string): string {
  if (!text) return "";
  return text
    // Remove standalone model codes: DF960, 6000C, 6148, DS1400 when used as codes
    .replace(/\b(?:model\s*(?:no\.?|number|#)?\s*)?[A-Z]{0,4}\d{3,5}[A-Z]?\b/gi, "")
    .replace(/\b\d{4,5}[A-Z]\b/g, "")
    // Clean leftover punctuation and spaces
    .replace(/\s*[-–/,]\s*[-–/,]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

export function humanProductName(name: string): string {
  const cleaned = humanizeProductText(name);
  return cleaned || name.split(/\s+/).slice(0, 4).join(" ");
}

export function formatProductForSpeech(p: {
  name: string;
  description?: string | null;
  price: number;
  min_price?: number | null;
  currency?: string;
  in_stock?: boolean;
}): string {
  const displayName = humanProductName(p.name);
  const desc = humanizeProductText(p.description || "") || "A quality option from our range";
  const currency = p.currency || "AUD";
  const priceNote = p.min_price
    ? `around $${p.price} ${currency}, with some room to negotiate`
    : `$${p.price} ${currency}`;
  const stock = p.in_stock !== false ? "available" : "currently out of stock";
  return `${displayName} — ${desc}. Priced at ${priceNote}, ${stock}.`;
}
