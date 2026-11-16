"use client";

import { VISIT_REASON_CODES, VISIT_REASON_LABEL, type VisitReasonCode } from "@/lib/domain/appointment";
import { Button, Dialog } from "@/components/ui";

/**
 * 노쇼·당일취소 사유 고르기 (기획서 4-3 규칙 3). 사유 버튼을 누르는 것이 곧 저장이다(확인 창 없음).
 */
export function ReasonDialog({
  title,
  onPick,
  onClose,
}: {
  title: string;
  onPick: (reason: VisitReasonCode) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      className="max-w-md"
      footer={
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <p className="mb-3 text-base text-slate-700">사유를 누르면 바로 저장됩니다.</p>
      <div className="grid grid-cols-2 gap-3">
        {VISIT_REASON_CODES.map((code) => (
          <Button key={code} variant="secondary" size="lg" onClick={() => onPick(code)}>
            {VISIT_REASON_LABEL[code]}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
