import { requireAuth } from "@/lib/auth";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";

export default async function NewCampaignPage() {
  await requireAuth();
  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">New campaign</h1>
      <NewCampaignForm />
    </div>
  );
}
