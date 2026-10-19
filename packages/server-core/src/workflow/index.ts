/**
 * Workflow helpers — state transitions, version creation, review aggregation.
 *
 * The authoritative state machine lives in packages/shared. This module
 * applies it against the Supabase database with optimistic concurrency.
 */

import { getServiceSupabase } from "../db";
import {
  assertLegalTransition,
  type TicketState,
} from "@mailpilot/shared";
import { audit } from "../audit";
import crypto from "node:crypto";

export interface TransitionInput {
  ticket_id: string;
  from: TicketState;
  to: TicketState;
  actor_id: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export async function transitionTicket(t: TransitionInput): Promise<void> {
  assertLegalTransition(t.from, t.to);
  const sb = getServiceSupabase();
  // Optimistic concurrency: UPDATE only if current_state still equals t.from.
  // Per line-by-line audit: preserve last_error when transitioning to
  // needs_attention/send_status_unknown/failed (carry the reason), clear it
  // when transitioning to a "happy path" state (analyzing, drafting, etc.).
  const shouldCarryError = ["needs_attention", "send_status_unknown", "failed", "blocked"].includes(t.to);
  const { data, error } = await sb
    .from("tickets")
    .update({
      current_state: t.to,
      updated_at: new Date().toISOString(),
      last_error: shouldCarryError ? (t.reason ?? null) : null,
    })
    .eq("id", t.ticket_id)
    .eq("current_state", t.from)
    .select("id, campaign_id")
    .maybeSingle();
  if (error) throw new Error(`Transition DB error: ${error.message}`);
  if (!data) {
    throw new Error(
      `Transition ${t.from} → ${t.to} rejected (ticket ${t.ticket_id} not in expected state)`,
    );
  }
  await sb.from("workflow_events").insert({
    id: crypto.randomUUID(),
    ticket_id: t.ticket_id,
    campaign_id: data.campaign_id,
    stage: t.to,
    event_type: "transition",
    metadata: { from: t.from, to: t.to, reason: t.reason ?? null, ...(t.metadata ?? {}) },
    error: null,
    created_at: new Date().toISOString(),
  });
  await audit({
    actor_id: t.actor_id,
    action: "ticket.transition",
    resource_type: "ticket",
    resource_id: t.ticket_id,
    campaign_id: data.campaign_id,
    ticket_id: t.ticket_id,
    metadata: { from: t.from, to: t.to, reason: t.reason ?? null },
  });
}

export async function recordWorkflowEvent(input: {
  ticket_id: string | null;
  campaign_id: string | null;
  stage: string;
  event_type: string;
  metadata?: Record<string, unknown>;
  error?: string | null;
}): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from("workflow_events").insert({
    id: crypto.randomUUID(),
    ticket_id: input.ticket_id,
    campaign_id: input.campaign_id,
    stage: input.stage,
    event_type: input.event_type,
    metadata: input.metadata ?? {},
    error: input.error ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`workflow_events insert: ${error.message}`);
}

export async function createEmailVersion(input: {
  ticket_id: string;
  subject: string;
  body_plain: string;
  body_html: string | null;
  source_references: unknown[];
  attachment_manifest: string[];
  created_by: "ai" | "human" | "system";
}): Promise<{ id: string; version_number: number }> {
  const sb = getServiceSupabase();
  // Race-safe version creation: retry up to 3 times on unique-constraint
  // violation. Two concurrent calls could read the same latest version_number
  // and both try to insert the same `next` — the unique constraint on
  // (ticket_id, version_number) rejects the second, so we re-read and retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: latest, error: lErr } = await sb
      .from("email_versions")
      .select("version_number")
      .eq("ticket_id", input.ticket_id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lErr) throw new Error(`Cannot read latest version: ${lErr.message}`);
    const next = (latest?.version_number ?? 0) + 1;
    const id = crypto.randomUUID();
    const { error } = await sb.from("email_versions").insert({
      id,
      ticket_id: input.ticket_id,
      version_number: next,
      subject: input.subject,
      body_plain: input.body_plain,
      body_html: input.body_html,
      source_references: input.source_references,
      attachment_manifest: input.attachment_manifest,
      created_by: input.created_by,
      created_at: new Date().toISOString(),
    });
    if (!error) return { id, version_number: next };
    // If it's a unique-constraint violation on (ticket_id, version_number),
    // retry. Otherwise throw.
    if (error.code === "23505" && attempt < 2) {
      continue;
    }
    throw new Error(`email_versions insert: ${error.message}`);
  }
  throw new Error("email_versions insert: exhausted retries on version conflict");
}

export async function setCurrentEmailVersion(
  ticket_id: string,
  version_id: string,
): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb
    .from("tickets")
    .update({ current_email_version_id: version_id, updated_at: new Date().toISOString() })
    .eq("id", ticket_id);
  if (error) throw new Error(`setCurrentEmailVersion: ${error.message}`);
}

// ─── Review aggregation ─────────────────────────────────────────────────────

import type { AiReview, ReviewDecision } from "@mailpilot/shared";

export interface AggregatedDecision {
  final: ReviewDecision;
  failed_reviewers: string[];
  has_critical: boolean;
  min_score: number | null;
  by_reviewer: Record<string, AiReview>;
}

export function aggregateReviews(
  reviews: AiReview[],
  requiredReviewers: readonly string[],
  minScore: number,
): AggregatedDecision {
  const by_reviewer: Record<string, AiReview> = {};
  for (const r of reviews) by_reviewer[r.reviewer_role] = r;
  const failed: string[] = [];
  let has_critical = false;
  let min_score: number | null = null;
  for (const role of requiredReviewers) {
    const r = by_reviewer[role];
    if (!r) {
      failed.push(role);
      continue;
    }
    if (r.decision === "error" || r.decision === "blocked") failed.push(role);
    if (r.decision === "revise") failed.push(role);
    if (r.score != null) {
      if (r.score < minScore) failed.push(role);
      min_score = min_score == null ? r.score : Math.min(min_score, r.score);
    }
    if (r.issues.some((i: { severity: string }) => i.severity === "critical")) has_critical = true;
  }
  // Per §13: "A critical unsupported claim, fabricated recipient fact,
  // missing mandatory section or serious compliance failure must block
  // approval." Critical issues go straight to `blocked`, not `revise` —
  // three wasted revision cycles per critical ticket would be expensive
  // and pointless when the issue is material.
  let final: ReviewDecision = "pass";
  if (reviews.some((r) => r.decision === "blocked")) {
    final = "blocked";
  } else if (reviews.some((r) => r.decision === "error" && requiredReviewers.includes(r.reviewer_role))) {
    // Errored required reviewer — manual intervention needed.
    final = "blocked";
  } else if (has_critical) {
    // Critical issue — block, don't revise.
    final = "blocked";
  } else if (failed.length > 0) {
    // Non-critical failure — revise.
    final = "revise";
  }
  return { final, failed_reviewers: failed, has_critical, min_score, by_reviewer };
}
