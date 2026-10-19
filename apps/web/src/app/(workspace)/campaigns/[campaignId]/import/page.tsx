import { requireAuth } from "@/lib/auth";
import { assertCampaignOwnedBy } from "@mailpilot/server-core";
import { ImportUploader } from "@/components/imports/import-uploader";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const user = await requireAuth();
  await assertCampaignOwnedBy(campaignId, user.id);
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Import spreadsheet</h1>
      <ImportUploader campaignId={campaignId} />
    </div>
  );
}
