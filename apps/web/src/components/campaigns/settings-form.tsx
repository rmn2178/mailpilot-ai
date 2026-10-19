"use client";

import { useEffect, useState } from "react";
import { CampaignSettingsSchema } from "@mailpilot/shared";

type Settings = {
  writing: Record<string, unknown>;
  approval: Record<string, unknown>;
  delivery: Record<string, unknown>;
  revision: { max_cycles: number };
};

export function CampaignSettingsForm({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((j) => {
        const d = j?.data?.settings;
        if (d) setData(d);
        else
          setData({
            writing: {
              purpose: "",
              sender_description: "",
              audience: "",
              tone: "professional",
              formality: "professional",
              desired_length: "medium",
              required_sections: [],
              prohibited_phrases: [],
              custom_instructions: "",
              call_to_action: "",
              humanization_intensity: "standard",
            },
            approval: {
              mode: "manual",
              required_reviewers: [
                "grok_defensibility",
                "grok_human_tone",
                "grok_content_fit",
                "grok_delivery_hygiene",
                "gemini_qa_structure",
                "gemini_qa_personalization",
              ],
              min_score: 70,
              auto_send: false,
            },
            delivery: {
              sending_mode: "draft",
              max_per_hour: 60,
              max_per_day: 500,
              permitted_hours: { start: 9, end: 18 },
              suppression_list: [],
            },
            revision: { max_cycles: 3 },
          });
      });
  }, [campaignId]);

  function patch(section: keyof Settings, key: string, value: unknown) {
    setData((prev) =>
      prev ? { ...prev, [section]: { ...prev[section], [key]: value } } : prev,
    );
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setMsg(null);
    const parsed = CampaignSettingsSchema.safeParse(data);
    if (!parsed.success) {
      setMsg("Validation failed: " + parsed.error.issues[0]?.message);
      setSaving(false);
      return;
    }
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: parsed.data }),
    });
    setSaving(false);
    setMsg(res.ok ? "Saved" : "Save failed");
  }

  if (!data) return <div className="text-ink-muted">Loading…</div>;

  return (
    <div className="space-y-6">
      <section className="panel panel-pad space-y-3">
        <h2 className="font-semibold">Writing</h2>
        <div>
          <label className="label">Purpose</label>
          <textarea
            className="input mt-1 min-h-[60px]"
            value={String(data.writing.purpose ?? "")}
            onChange={(e) => patch("writing", "purpose", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Tone</label>
            <input className="input mt-1" value={String(data.writing.tone ?? "")}
              onChange={(e) => patch("writing", "tone", e.target.value)} />
          </div>
          <div>
            <label className="label">Formality</label>
            <select className="input mt-1" value={String(data.writing.formality ?? "professional")}
              onChange={(e) => patch("writing", "formality", e.target.value)}>
              <option>casual</option>
              <option>professional</option>
              <option>formal</option>
            </select>
          </div>
          <div>
            <label className="label">Length</label>
            <select className="input mt-1" value={String(data.writing.desired_length ?? "medium")}
              onChange={(e) => patch("writing", "desired_length", e.target.value)}>
              <option>short</option>
              <option>medium</option>
              <option>long</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Call to action</label>
          <input className="input mt-1" value={String(data.writing.call_to_action ?? "")}
            onChange={(e) => patch("writing", "call_to_action", e.target.value)} />
        </div>
        <div>
          <label className="label">Prohibited phrases (one per line)</label>
          <textarea
            className="input mt-1 min-h-[60px]"
            value={(data.writing.prohibited_phrases as string[] | undefined)?.join("\n") ?? ""}
            onChange={(e) =>
              patch("writing", "prohibited_phrases", e.target.value.split("\n").filter(Boolean))
            }
          />
        </div>
      </section>

      <section className="panel panel-pad space-y-3">
        <h2 className="font-semibold">Approval</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Mode</label>
            <select className="input mt-1" value={String(data.approval.mode ?? "manual")}
              onChange={(e) => patch("approval", "mode", e.target.value)}>
              <option value="manual">Manual approval</option>
              <option value="auto">Eligible auto-approval</option>
            </select>
          </div>
          <div>
            <label className="label">Minimum score</label>
            <input type="number" className="input mt-1" value={Number(data.approval.min_score ?? 70)}
              onChange={(e) => patch("approval", "min_score", Number(e.target.value))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(data.approval.auto_send)}
            onChange={(e) => patch("approval", "auto_send", e.target.checked)} />
          Auto-send after approval (separate from auto-approval)
        </label>
      </section>

      <section className="panel panel-pad space-y-3">
        <h2 className="font-semibold">Delivery</h2>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Max per hour</label>
            <input type="number" className="input mt-1" value={Number(data.delivery.max_per_hour ?? 60)}
              onChange={(e) => patch("delivery", "max_per_hour", Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Max per day</label>
            <input type="number" className="input mt-1" value={Number(data.delivery.max_per_day ?? 500)}
              onChange={(e) => patch("delivery", "max_per_day", Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Sending mode</label>
            <select className="input mt-1" value={String(data.delivery.sending_mode ?? "draft")}
              onChange={(e) => patch("delivery", "sending_mode", e.target.value)}>
              <option value="draft">Draft</option>
              <option value="direct">Direct send</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Permitted hours start</label>
            <input type="number" min={0} max={23} className="input mt-1"
              value={Number((data.delivery.permitted_hours as { start: number })?.start ?? 9)}
              onChange={(e) =>
                patch("delivery", "permitted_hours", {
                  ...(data.delivery.permitted_hours as object),
                  start: Number(e.target.value),
                })
              } />
          </div>
          <div>
            <label className="label">Permitted hours end</label>
            <input type="number" min={0} max={23} className="input mt-1"
              value={Number((data.delivery.permitted_hours as { end: number })?.end ?? 18)}
              onChange={(e) =>
                patch("delivery", "permitted_hours", {
                  ...(data.delivery.permitted_hours as object),
                  end: Number(e.target.value),
                })
              } />
          </div>
        </div>
      </section>

      <section className="panel panel-pad space-y-3">
        <h2 className="font-semibold">Revision</h2>
        <label className="label">Max revision cycles</label>
        <input type="number" min={0} max={10} className="input"
          value={data.revision.max_cycles}
          onChange={(e) =>
            setData((prev) =>
              prev ? { ...prev, revision: { max_cycles: Number(e.target.value) } } : prev,
            )
          } />
      </section>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className="text-sm text-ink-muted">{msg}</span>}
      </div>
    </div>
  );
}
