import type { Metadata } from "next";
import { Suspense } from "react";
import { PatientDetail } from "@/components/patients/patient-detail";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "고객 상세 · 치과 CRM" };

/** Cache Components: 요청 때 정해지는 params는 Suspense 안에서 읽는다. 데이터는 PatientDetail이 /api로 읽는다. */
export default function PatientPage({ params }: PageProps<"/patients/[id]">) {
  return (
    <Suspense fallback={<Spinner showLabel label="불러오는 중" />}>
      {params.then(({ id }) => (
        <PatientDetail id={id} />
      ))}
    </Suspense>
  );
}
