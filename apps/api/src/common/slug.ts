/**
 * URL-safe slug generation used by organizations and roles.
 *
 * Unicode is normalised first so "Café Ops" becomes `cafe-ops` rather than
 * losing the word entirely. Length is capped at the DB column width.
 */
export const slugify = (value: string, maxLength = 64): string => {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);

  return slug.length > 0 ? slug : "item";
};

export const withNumericSuffix = (
  base: string,
  suffix: number,
  maxLength = 64,
): string => {
  const suffixText = `-${suffix}`;
  return `${base.slice(0, maxLength - suffixText.length)}${suffixText}`;
};
