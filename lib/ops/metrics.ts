import { logInfo, type LogContext } from "@/lib/ops/logger";

export function emitMetric(
  name: string,
  value = 1,
  tags: LogContext = {}
) {
  return logInfo("ops.metric", {
    metricName: name,
    metricValue: value,
    tags
  });
}
