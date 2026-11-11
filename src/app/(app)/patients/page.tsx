import type { Metadata } from "next";
import { PatientSearch } from "@/components/patients/patient-search";

export const metadata: Metadata = { title: "고객 · 치과 CRM" };

export default function PatientsPage() {
  return <PatientSearch />;
}
