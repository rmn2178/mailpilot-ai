import { NextResponse } from "next/server";
import { getServiceSupabase, audit } from "@mailpilot/server-core";
import { DEFAULT_REQUIRED_REVIEWERS } from "@mailpilot/shared";
import { requireAuth } from "@/lib/auth";
import { ok, failFromZod, failInternal, fail } from "@/lib/api/responses";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1),
  writing: z
    .object({
      purpose: z.string().default(""),
      audience: z.string().default(""),
      tone: z.string().default("professional"),
    })
    .default({}),
});

export async function GET() {
  try {
    const user = await requireAuth();
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("campaigns")
      .select("id, name, status, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ok({ campaigns: data ?? [] });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return failFromZod(parsed.error);
    const sb = getServiceSupabase();

    const { data: campaign, error } = await sb
      .from("campaigns")
      .insert({
        owner_id: user.id,
        name: parsed.data.name,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await sb.from("campaign_settings").insert({
      campaign_id: campaign.id,
      settings_version: 1,
      writing: {
        purpose: parsed.data.writing.purpose,
        audience: parsed.data.writing.audience,
        tone: parsed.data.writing.tone,
        formality: "professional",
        desired_length: "medium",
        required_sections: [],
        call_to_action: "",
        prohibited_phrases: [],
        custom_instructions: "",
        humanization_intensity: "standard",
      },
      approval: { mode: "manual", required_reviewers: [...DEFAULT_REQUIRED_REVIEWERS], min_score: 70, auto_send: false },
      delivery: {
        sending_mode: "draft",
        max_per_hour: 60,
        max_per_day: 500,
        permitted_hours: { start: 9, end: 18 },
        suppression_list: [],
      },
      revision: { max_cycles: 3 },
    });

    await audit({
      actor_id: user.id,
      action: "campaign.create",
      resource_type: "campaign",
      resource_id: campaign.id,
      campaign_id: campaign.id,
      ticket_id: null,
      metadata: { name: parsed.data.name },
    });

    return ok({ id: campaign.id });
  } catch (e) {
    return failInternal((e as Error).message);
  }
}
