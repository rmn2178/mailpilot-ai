import { requireAuth } from "@/lib/auth";
import { assertCampaignOwnedBy } from "@mailpilot/server-core";
import { CampaignSettingsForm } from "@/components/campaigns/settings-form";

export const dynamic = "force-dynamic";

export default async function CampaignSettingsPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const user = await requireAuth();
  await assertCampaignOwnedBy(campaignId, user.id);
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Campaign settings</h1>
      <CampaignSettingsForm campaignId={campaignId} />
    </div>
  );
}
