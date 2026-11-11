import type { Metadata } from "next";
import { PatientForm } from "@/components/patients/patient-form";

export const metadata: Metadata = { title: "고객 등록 · 치과 CRM" };

export default function NewPatientPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">고객 등록</h1>
      <PatientForm />
    </div>
  );
}
