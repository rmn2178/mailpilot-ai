"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewCampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("professional");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        writing: { purpose, audience, tone },
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j?.error?.message ?? "Failed to create campaign");
      return;
    }
    const j = (await res.json()) as { data: { id: string } };
    router.push(`/campaigns/${j.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="panel panel-pad space-y-4">
      <div>
        <label className="label">Name</label>
        <input
          className="input mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Q4 outreach"
        />
      </div>
      <div>
        <label className="label">Purpose</label>
        <textarea
          className="input mt-1 min-h-[80px]"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          required
          placeholder="Briefly describe what these emails should accomplish"
        />
      </div>
      <div>
        <label className="label">Audience</label>
        <input
          className="input mt-1"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. Product managers at B2B SaaS companies"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Tone</label>
          <select
            className="input mt-1"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          >
            <option>professional</option>
            <option>conversational</option>
            <option>formal</option>
          </select>
        </div>
      </div>
      {error && (
        <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create campaign"}
        </button>
      </div>
    </form>
  );
}
