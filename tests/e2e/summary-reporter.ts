import { mkdirSync, writeFileSync } from 'node:fs';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export default class SummaryReporter implements Reporter {
  private counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 };
  onTestEnd(_test: TestCase, result: TestResult) { this.counts[result.status]++; }
  onEnd(result: FullResult) {
    mkdirSync('test-results', {recursive: true});
    // Deliberate allowlist: no errors, parameters, environment, or browser state.
    writeFileSync(`test-results/summary-${Date.now()}.json`, JSON.stringify({status: result.status, counts: this.counts}, null, 2));
  }
}
