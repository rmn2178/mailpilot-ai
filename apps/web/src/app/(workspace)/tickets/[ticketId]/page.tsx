import { requireAuth } from "@/lib/auth";
import { getServiceSupabase } from "@mailpilot/server-core";
import { notFound } from "next/navigation";
import { TicketWorkspace } from "@/components/tickets/ticket-workspace";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const user = await requireAuth();
  const sb = getServiceSupabase();

  const { data: ticket } = await sb
    .from("tickets")
    .select(
      "id, campaign_id, contact_id, recipient_email, current_state, current_email_version_id, approval_status, revision_attempts, last_error, created_at, updated_at",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) notFound();

  // Ownership check
  const { data: campaign } = await sb
    .from("campaigns")
    .select("owner_id, name")
    .eq("id", ticket.campaign_id)
    .maybeSingle();
  if (!campaign || campaign.owner_id !== user.id) notFound();

  const { data: contact } = await sb
    .from("contacts")
    .select("email, first_name, last_name, company, job_title, custom_fields")
    .eq("id", ticket.contact_id)
    .maybeSingle();

  const { data: versions } = await sb
    .from("email_versions")
    .select("id, version_number, subject, body_plain, body_html, source_references, created_by, created_at")
    .eq("ticket_id", ticketId)
    .order("version_number", { ascending: false });

  const { data: reviews } = await sb
    .from("ai_reviews")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("started_at", { ascending: false });

  const { data: events } = await sb
    .from("workflow_events")
    .select("id, stage, event_type, metadata, error, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: attachments } = await sb
    .from("ticket_attachments")
    .select("id, filename, mime, size_bytes")
    .eq("ticket_id", ticketId);

  return (
    <TicketWorkspace
      ticket={ticket}
      campaignName={campaign.name}
      contact={contact}
      versions={versions ?? []}
      reviews={reviews ?? []}
      events={events ?? []}
      attachments={attachments ?? []}
    />
  );
}
