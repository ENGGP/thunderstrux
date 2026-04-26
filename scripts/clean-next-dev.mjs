import { rmSync } from "node:fs";
import { join } from "node:path";

rmSync(join(process.cwd(), ".next", "dev"), {
  force: true,
  recursive: true
});
