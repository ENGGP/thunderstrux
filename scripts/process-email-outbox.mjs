import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/": `${process.cwd().replace(/\\/g, "/")}/`
  }
});

await jiti.import("./process-email-outbox.ts");
