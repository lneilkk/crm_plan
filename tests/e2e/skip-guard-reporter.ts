/**
 * 건너뛴 시나리오가 있으면 실행 전체를 실패로 바꾸는 리포터 (playwright.config.ts에 등록).
 *
 * 몇몇 시나리오는 '오늘 이미 시작한 예약'이 필요해 한국 시간 자정 앞뒤 1시간에는 스스로 건너뛴다.
 * 건너뛴 채로 "통과"가 나오면 R1 완료 확인이 시나리오를 돌리지 않고도 통과할 수 있으므로,
 * 기본으로는 실패시키고 건너뛴 테스트와 이유를 출력한다.
 * 건너뛰어도 되는 실행(예: 밤에 화면만 빨리 확인)은 E2E_ALLOW_SKIP=1로 실행한다.
 */
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export default class SkipGuardReporter implements Reporter {
  private skipped: { title: string; reason: string }[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "skipped") return;
    const reason = test.annotations.find((annotation) => annotation.type === "skip")?.description ?? "";
    this.skipped.push({ title: test.titlePath().filter(Boolean).join(" › "), reason });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    if (this.skipped.length === 0) return undefined;
    const allowed = process.env.E2E_ALLOW_SKIP === "1";
    process.stdout.write(`\n[e2e] 건너뛴 시나리오 ${this.skipped.length}개:\n`);
    for (const { title, reason } of this.skipped) process.stdout.write(`  - ${title}${reason ? ` (${reason})` : ""}\n`);
    if (allowed) {
      process.stdout.write("[e2e] E2E_ALLOW_SKIP=1 — 건너뛴 시나리오가 있어도 실패로 보지 않는다.\n");
      return undefined;
    }
    process.stdout.write(
      "[e2e] 건너뛴 시나리오가 있어 실패로 처리한다. 모든 시나리오는 한국 시간 01:00~23:00에 돌린다 (건너뛰어도 되면 E2E_ALLOW_SKIP=1).\n",
    );
    return { status: result.status === "passed" ? "failed" : result.status };
  }
}
