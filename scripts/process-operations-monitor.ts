import { runOperationsMonitor } from "@/lib/ops/monitor";
import { runWorker } from "@/lib/ops/worker";

// T42: queue backlog, oldest-age and stale-job metrics and alerts, every minute.
void runWorker("monitor", () => runOperationsMonitor());
