import { Wizard } from "@/components/wizard/wizard";

export default function InspectionPage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="mx-auto w-full max-w-screen-2xl">
        <Wizard id={params.id} />
      </div>
    </div>
  );
}
