import { Button, cn } from "@/components/ui";

/*
 * [편집]의 목록 편집기(예약 항목·색 라벨·체어·상담 결과)가 함께 쓰는 줄 버튼 — 확장 계획 S-6.
 * 순서 바꾸기는 moveItem(src/lib/list.ts)으로 한다. 버튼 이름(aria-label)은 "<항목 이름> 위로/아래로/삭제".
 */

/** ▲·▼ 순서 버튼. 맨 위·맨 아래에서는 꺼진다 */
export function OrderButtons({
  name,
  index,
  count,
  onMove,
  className,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (index: number, delta: -1 | 1) => void;
  className?: string;
}) {
  return (
    <>
      <Button variant="ghost" className={className} aria-label={`${name} 위로`} disabled={index === 0} onClick={() => onMove(index, -1)}>
        ▲
      </Button>
      <Button variant="ghost" className={className} aria-label={`${name} 아래로`} disabled={index === count - 1} onClick={() => onMove(index, 1)}>
        ▼
      </Button>
    </>
  );
}

/** 줄 지우기 버튼 (저장해야 반영된다) */
export function RemoveButton({ name, onRemove, text = "삭제", className }: { name: string; onRemove: () => void; text?: string; className?: string }) {
  return (
    <Button variant="ghost" className={cn(className, "text-red-700")} aria-label={`${name} ${text}`} onClick={onRemove}>
      {text}
    </Button>
  );
}
