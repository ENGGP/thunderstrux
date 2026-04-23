const unsupportedCharacters = /[^a-z0-9-]/g;
const repeatedHyphens = /-+/g;
const edgeHyphens = /^-|-$/g;

export function normaliseSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(unsupportedCharacters, "")
    .replace(repeatedHyphens, "-")
    .replace(edgeHyphens, "");
}
