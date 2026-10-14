import type { ReactNode } from "react";
import { prerender } from "react-dom/static";

// Renders a server page to HTML after every Suspense boundary has resolved,
// as Next does. renderToStaticMarkup would print only the skeleton fallbacks.
// An error inside a boundary (a failed read, notFound, redirect) is rethrown
// instead of being swapped for client rendering.
export async function renderPage(element: ReactNode) {
  let failure: unknown;
  const { prelude } = await prerender(element, {
    onError(error) {
      failure ??= error;
    }
  });
  const html = await new Response(prelude).text();

  if (failure) {
    throw failure;
  }

  // Drop the separators hydration needs between adjacent text, so assertions
  // read text as renderToStaticMarkup printed it ("0 remaining").
  return html.replaceAll("<!-- -->", "");
}
