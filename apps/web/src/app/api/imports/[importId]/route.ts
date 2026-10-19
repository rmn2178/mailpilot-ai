import { NextRequest } from "next/server";
import { getServiceSupabase, assertCampaignOwnedBy, audit } from "@mailpilot/server-core";
import { requireAuth } from "@/lib/auth";
import { ok, fail, failInternal } from "@/lib/api/responses";
import { triggerPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Per §2.9: the previous version of this route did the parsing in the GET
 * handler, racing with the worker's import.processor.ts. Now the GET handler
 * ONLY reads persisted state. Parsing is the worker's job.
 *
 * If the import is still in `uploaded` status, we enqueue a parse job and
 * return a "parsing" response. The client polls until status becomes
 * `import_preview`.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ importId: string }> },
) {
  try {
    const { importId } = await ctx.params;
    const user = await requireAuth();
    const sb = getServiceSupabase();
    const { data: imp } = await sb.from("imports").select("*").eq("id", importId).maybeSingle();
    if (!imp) return fail("NOT_FOUND", "Import not found", 404);
    await assertCampaignOwnedBy(imp.campaign_id, user.id);

    // If the import is still in `uploaded` status, the worker hasn't picked
    // it up yet. Try to enqueue a parse job — idempotent on the import id.
    if (imp.status === "uploaded") {
      triggerPipeline({ job: "import", importId }, req.url);
      return ok({ import: imp, status: "parsing_started", rows: [] });
    }

    const { data: rows } = await sb
      .from("import_rows")
      .select("*")
      .eq("import_id", importId)
      .order("row_number")
      .limit(200);
    return ok({ import: imp, rows: rows ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ importId: string }> },
) {
  try {
    const { importId } = await ctx.params;
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "confirm";
    const sb = getServiceSupabase();
    const { data: imp } = await sb.from("imports").select("*").eq("id", importId).maybeSingle();
    if (!imp) return fail("NOT_FOUND", "Import not found", 404);
    await assertCampaignOwnedBy(imp.campaign_id, user.id);

    if (action === "confirm") {
      // Create one contact + one ticket per valid row, idempotent on stable_hash
      // and (campaign_id, contact_id). The unique constraint on tickets ensures
      // re-confirming an import does not create duplicates.
      const { data: validRows } = await sb.from("import_rows").select("*").eq("import_id", importId).eq("status", "valid");
      let created = 0;
      let skipped = 0;
      for (const r of validRows ?? []) {
        const m = r.mapped as { email?: string | null; first_name?: string | null; last_name?: string | null; company?: string | null; job_title?: string | null };
        const { data: contact, error: cErr } = await sb.from("contacts").upsert({
          campaign_id: imp.campaign_id,
          email: m.email ?? "",
          first_name: m.first_name ?? null,
          last_name: m.last_name ?? null,
          company: m.company ?? null,
          job_title: m.job_title ?? null,
          stable_hash: r.stable_hash,
        }, { onConflict: "campaign_id,stable_hash" }).select("id").maybeSingle();
        if (cErr || !contact?.id) {
          skipped += 1;
          continue;
        }
        // Per bug B: use ignoreDuplicates so re-confirming an import does NOT
        // reset existing tickets to "queued". The previous version used a
        // standard upsert that overwrote current_state — re-confirming after
        // tickets had advanced (e.g. some sent) would silently re-queue them,
        // causing duplicate sends.
        const { data: existingTicket } = await sb.from("tickets")
          .select("id")
          .eq("campaign_id", imp.campaign_id)
          .eq("contact_id", contact.id)
          .maybeSingle();
        if (existingTicket) {
          // Ticket already exists — skip (don't touch its current_state).
          skipped += 1;
          continue;
        }
        const { data: ticket, error: tErr } = await sb.from("tickets").insert({
          campaign_id: imp.campaign_id,
          contact_id: contact.id,
          recipient_email: m.email ?? "",
          current_state: "queued",
        }).select("id").maybeSingle();
        if (tErr) {
          skipped += 1;
          continue;
        }
        if (ticket?.id) created += 1;
      }
      await sb.from("imports").update({ status: "import_completed" }).eq("id", importId);
      await audit({
        actor_id: user.id,
        action: "import.confirm",
        resource_type: "import",
        resource_id: importId,
        campaign_id: imp.campaign_id,
        ticket_id: null,
        metadata: { created, skipped },
      });
      return ok({ created, skipped });
    }
    if (action === "cancel") {
      await sb.from("imports").update({ status: "import_cancelled" }).eq("id", importId);
      return ok({ cancelled: true });
    }
    return fail("VALIDATION_ERROR", "Unknown action", 400);
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
