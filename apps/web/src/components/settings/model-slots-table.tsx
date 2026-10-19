"use client";

import { useState } from "react";

interface Slot {
  slot: string;
  provider: "gemini" | "grok";
  model_id: string;
  credential_slot: number;
  enabled: boolean;
  max_concurrency: number;
  request_budget_per_minute: number;
  timeout_ms: number;
  cooldown_until: string | null;
  last_error: string | null;
  tokens_in: number;
  tokens_out: number;
}

export function ModelSlotsTable({ slots }: { slots: Slot[] }) {
  const [state, setState] = useState<Slot[]>(slots);
  const [saving, setSaving] = useState<string | null>(null);

  async function save(s: Slot) {
    setSaving(s.slot);
    await fetch("/api/settings/models", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    setSaving(null);
  }

  return (
    <div className="panel">
      <table className="w-full text-sm">
        <thead className="text-ink-muted text-xs uppercase">
          <tr className="border-b border-line">
            <th className="text-left font-medium px-3 py-2">Slot</th>
            <th className="text-left font-medium px-3 py-2">Model</th>
            <th className="text-left font-medium px-3 py-2">Credential</th>
            <th className="text-left font-medium px-3 py-2">Enabled</th>
            <th className="text-left font-medium px-3 py-2">Concurrency</th>
            <th className="text-left font-medium px-3 py-2">Budget/min</th>
            <th className="text-left font-medium px-3 py-2">Tokens</th>
            <th className="text-left font-medium px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {state.map((s) => (
            <tr key={s.slot} className="border-b border-line last:border-0">
              <td className="px-3 py-2 font-mono">{s.slot}</td>
              <td className="px-3 py-2">
                <input className="input" value={s.model_id}
                  onChange={(e) => setState((prev) => prev.map((p) => p.slot === s.slot ? { ...p, model_id: e.target.value } : p))} />
              </td>
              <td className="px-3 py-2">
                <select className="input" value={s.credential_slot}
                  onChange={(e) => setState((prev) => prev.map((p) => p.slot === s.slot ? { ...p, credential_slot: Number(e.target.value) } : p))}>
                  <option value={1}>slot 1</option>
                  <option value={2}>slot 2</option>
                  <option value={3}>slot 3</option>
                  <option value={4}>slot 4</option>
                </select>
              </td>
              <td className="px-3 py-2">
                <input type="checkbox" checked={s.enabled}
                  onChange={(e) => setState((prev) => prev.map((p) => p.slot === s.slot ? { ...p, enabled: e.target.checked } : p))} />
              </td>
              <td className="px-3 py-2">
                <input type="number" className="input w-16" value={s.max_concurrency}
                  onChange={(e) => setState((prev) => prev.map((p) => p.slot === s.slot ? { ...p, max_concurrency: Number(e.target.value) } : p))} />
              </td>
              <td className="px-3 py-2">
                <input type="number" className="input w-20" value={s.request_budget_per_minute}
                  onChange={(e) => setState((prev) => prev.map((p) => p.slot === s.slot ? { ...p, request_budget_per_minute: Number(e.target.value) } : p))} />
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted">
                {(s.tokens_in / 1000).toFixed(1)}k in / {(s.tokens_out / 1000).toFixed(1)}k out
              </td>
              <td className="px-3 py-2">
                <button className="btn" onClick={() => save(s)} disabled={saving === s.slot}>
                  {saving === s.slot ? "…" : "Save"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
