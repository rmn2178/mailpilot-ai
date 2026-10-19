import { requireAuth } from "@/lib/auth";
import { getServiceSupabase, assertCampaignOwnedBy } from "@mailpilot/server-core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportStatusPoller } from "@/components/imports/import-status-poller";
import { CampaignActions } from "@/components/campaigns/campaign-actions";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ import?: string }>;
}) {
  const { campaignId } = await params;
  const { import: importId } = await searchParams;
  const user = await requireAuth();
  await assertCampaignOwnedBy(campaignId, user.id);
  const sb = getServiceSupabase();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) notFound();

  const { data: imports } = await sb
    .from("imports")
    .select("id, filename, status, total_rows, valid_rows, invalid_rows, duplicate_rows, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  const { count: ticketCount } = await sb
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <div className="text-sm text-ink-muted mt-1">
            Status: <span className="capitalize">{campaign.status}</span> · {ticketCount ?? 0} tickets
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/campaigns/${campaignId}/import`} className="btn">
            Import spreadsheet
          </Link>
          <Link href={`/campaigns/${campaignId}/settings`} className="btn">
            Settings
          </Link>
          <CampaignActions campaignId={campaignId} initialStatus={campaign.status} />
        </div>
      </div>

      {/* When the user lands here with ?import=… after uploading, poll until
          parsing completes so they see live progress instead of a dead page.
          The "View tickets" link is intentionally NOT shown until confirm
          completes — it would be a dead-end before that. */}
      {importId && (
        <div className="panel panel-pad">
          <h2 className="font-semibold text-sm mb-2">Import in progress</h2>
          <ImportStatusPoller importId={importId} />
        </div>
      )}

      <div className="panel">
        <div className="px-4 py-3 border-b border-line font-semibold text-sm">
          Imports
        </div>
        <table className="w-full text-sm">
          <thead className="text-ink-muted text-xs uppercase">
            <tr className="border-b border-line">
              <th className="text-left font-medium px-4 py-2">File</th>
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-left font-medium px-4 py-2">Valid</th>
              <th className="text-left font-medium px-4 py-2">Invalid</th>
              <th className="text-left font-medium px-4 py-2">Duplicates</th>
            </tr>
          </thead>
          <tbody>
            {!imports || imports.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  No imports yet. <Link href={`/campaigns/${campaignId}/import`} className="text-brand hover:underline">Import a spreadsheet</Link>.
                </td>
              </tr>
            ) : (
              imports.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{i.filename}</td>
                  <td className="px-4 py-2 capitalize">{i.status.replace("import_", "")}</td>
                  <td className="px-4 py-2">{i.valid_rows ?? 0}</td>
                  <td className="px-4 py-2">{i.invalid_rows ?? 0}</td>
                  <td className="px-4 py-2">{i.duplicate_rows ?? 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
