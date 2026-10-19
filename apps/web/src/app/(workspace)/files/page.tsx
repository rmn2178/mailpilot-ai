import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { formatDate } from "@/lib/utils";
import { FileUploadButton } from "@/components/files/file-upload-button";
import { DeleteFileButton } from "@/components/files/delete-file-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const user = await requireAuth();
  const sb = getServiceSupabase();
  const { data: campaigns } = await sb
    .from("campaigns")
    .select("id, name")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  const ids = (campaigns ?? []).map((c) => c.id);
  const { data: files } = ids.length
    ? await sb
        .from("campaign_files")
        .select("id, filename, mime, size_bytes, purpose, extraction_status, extraction_failure, created_at, campaign_id")
        .in("campaign_id", ids)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Group files by campaign so the upload button can target a specific campaign.
  type FileRow = NonNullable<typeof files>[number];
  const byCampaign = new Map<string, { name: string; files: FileRow[] }>();
  for (const c of campaigns ?? []) {
    byCampaign.set(c.id, { name: c.name, files: [] });
  }
  for (const f of (files ?? []) as FileRow[]) {
    const entry = byCampaign.get(f.campaign_id);
    if (entry) entry.files.push(f);
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-ink-muted">
          Reference files used by the AI when analyzing campaigns and drafting
          emails. Attachments to outgoing emails are managed per-ticket.
        </p>
      </div>

      {byCampaign.size === 0 ? (
        <div className="panel panel-pad text-sm text-ink-muted">
          No campaigns yet. <Link href="/campaigns/new" className="text-brand hover:underline">Create one</Link> first.
        </div>
      ) : (
        Array.from(byCampaign.entries()).map(([cid, entry]) => (
          <div key={cid} className="panel">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">{entry.name}</div>
                <div className="text-xs text-ink-muted">
                  <Link href={`/campaigns/${cid}`} className="hover:underline">Open campaign</Link>
                </div>
              </div>
              <FileUploadButton campaignId={cid} />
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-xs uppercase">
                <tr className="border-b border-line">
                  <th className="text-left font-medium px-4 py-2">File</th>
                  <th className="text-left font-medium px-4 py-2">Purpose</th>
                  <th className="text-left font-medium px-4 py-2">Extraction</th>
                  <th className="text-left font-medium px-4 py-2">Uploaded</th>
                  <th className="text-left font-medium px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(!entry.files || entry.files.length === 0) ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-center text-ink-muted">No reference files yet.</td></tr>
                ) : (
                  entry.files.map((f) => {
                    return (
                      <tr key={f.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">{f.filename}</td>
                        <td className="px-4 py-2">{f.purpose.replace(/_/g, " ")}</td>
                        <td className="px-4 py-2">
                          <span className={
                            f.extraction_status === "completed" ? "pill-success" :
                            f.extraction_status === "failed" ? "pill-danger" :
                            f.extraction_status === "extracting" ? "pill-info" : "pill-warn"
                          }>
                            {f.extraction_status}
                          </span>
                          {f.extraction_failure && (
                            <div className="text-xs text-danger mt-1">{f.extraction_failure}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-ink-muted">{formatDate(f.created_at)}</td>
                        <td className="px-4 py-2">
                          <DeleteFileButton campaignId={cid} fileId={f.id} filename={f.filename} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
