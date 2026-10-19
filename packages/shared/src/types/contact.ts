export interface Contact {
  id: string;
  campaign_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  custom_fields: Record<string, unknown> | null;
  stable_hash: string;
  created_at: string;
}

export interface ImportRowRecord {
  row_number: number;
  raw: Record<string, unknown>;
  mapped: Partial<{
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    job_title: string | null;
  }>;
  status: "valid" | "invalid" | "duplicate" | "empty";
  reasons: string[];
}
