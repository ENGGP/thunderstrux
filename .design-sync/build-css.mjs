// Compiles app/globals.css (Tailwind v4 + --ts-* tokens) to one static stylesheet for design-sync.
// next/font injects --font-dm-sans / --font-space-grotesk at runtime in the app; here we load the
// same families from Google Fonts and define those variables so the font stacks resolve.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "app/globals.css");
const out = resolve(root, ".design-sync/.cache/thunderstrux.css");

const fonts = `@import url("https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Space+Grotesk:wght@300..700&display=swap");
:root { --font-dm-sans: "DM Sans"; --font-space-grotesk: "Space Grotesk"; }
`;

// Tailwind only emits classes it finds in source, so designs would lack common layout glue
// (gap-*, max-w-*, font-bold...). Safelist a basic set for the design agent's own layout.
const safelist = `
@source inline("{sm:,md:,lg:,}{p,px,py,m,mx,my,mt,mb,gap}-{0,1,2,3,4,5,6,8,10,12,16}");
@source inline("text-{xs,sm,base,lg,xl,2xl,3xl,4xl}");
@source inline("font-{medium,semibold,bold}");
@source inline("max-w-{sm,md,lg,xl,2xl,3xl}");
@source inline("{sm:,md:,lg:,}grid-cols-{1,2,3,4}");
@source inline("{sm:,md:,lg:,}{flex,grid,flex-col,flex-wrap,w-full,mx-auto,text-center,items-start,items-center,items-end,justify-between,justify-center,justify-end}");
`;
const result = await postcss([tailwind({ base: root })]).process(readFileSync(from, "utf8") + safelist, { from });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, fonts + result.css);
console.log(`wrote ${out} (${result.css.length} bytes)`);
