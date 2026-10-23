// The app's public origin, read when called. `next build` inlines every literal
// read of a NEXT_PUBLIC_ variable into the server bundles too, which tied a release
// image to the domain it was built for (T44d). A computed key is left for the
// running server, so one image serves whichever domain it is deployed to.
const key = "NEXT_PUBLIC_APP_URL";

export function appUrl(): string | undefined {
  return process.env[key];
}
