import { notFound } from "next/navigation";
import { ReplayWorkspace } from "@/components/replay-workspace";
import { defaultExecutionMode } from "@/lib/demo-mode";
export default async function PatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (!["P-101", "P-201"].includes(patientId)) notFound();
  return <ReplayWorkspace key={patientId} initialPatientId={patientId} initialMode={defaultExecutionMode(process.env)} />;
}
