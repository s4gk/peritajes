import { InspectionList } from "@/components/wizard/inspection-list";

export default function Page() {
  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="container max-w-6xl">
        <InspectionList />
      </div>
    </div>
  );
}
