/**
 * 공용 화면 부품 (shadcn 대신 직접 쓴 작은 Tailwind 컴포넌트).
 *
 * 쓰는 법: `import { Button, Input, Label, Dialog, Toast } from "@/components/ui";`
 * 병원 태블릿에서 손가락으로 누르기 쉽게 버튼·입력칸은 높이 44px 이상(Button size="lg"는 56px)이고 글자는 16px 이상이다.
 * Button은 variant(primary·secondary·danger·ghost)와 size(md·lg), Badge는 tone(neutral·info·success·warning·danger·muted)을 받는다.
 * 각 부품은 해당 HTML 요소의 속성을 그대로 받고 className으로 덧붙일 수 있다(cn으로 합친다).
 * Dialog·Toast는 클라이언트 컴포넌트다: Dialog는 open/onClose로 제어하며 Esc·바깥 클릭으로 닫히고,
 * Toast는 durationMs 뒤 onClose를 부르며 action을 주면 남은 초와 함께 버튼(예: 5초 "되돌리기")을 보여 준다.
 * 화면 문구는 한국어로 쓰고, 이름·전화번호는 마스킹 함수(src/lib/masking.ts)를 거쳐 보여 준다.
 */
export { Badge, type BadgeTone } from "./badge";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
export { Card, CardTitle } from "./card";
export { cn } from "./cn";
export { Dialog } from "./dialog";
export { EmptyState } from "./empty-state";
export { FieldError, Input, Label, Select } from "./form";
export { Spinner } from "./spinner";
export { Table, TBody, Td, Th, THead, Tr } from "./table";
export { Toast, type ToastTone } from "./toast";
