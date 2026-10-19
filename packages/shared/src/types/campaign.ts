export interface Campaign {
  id: string;
  owner_id: string;
  name: string;
  status:
    | "draft"
    | "active"
    | "paused"
    | "completed"
    | "archived";
  settings_version: number;
  // Note: `sending_mode` was dropped from the campaigns table in migration
  // 0007. The single source of truth is `campaign_settings.delivery.sending_mode`.
  created_at: string;
  updated_at: string;
}

export interface CampaignSettings {
  writing: {
    purpose: string;
    sender_description: string;
    audience: string;
    tone: string;
    formality: "casual" | "professional" | "formal";
    desired_length: "short" | "medium" | "long";
    required_sections: string[];
    call_to_action: string;
    prohibited_phrases: string[];
    custom_instructions: string;
    humanization_intensity: "light" | "standard" | "strong";
  };
  approval: {
    mode: "manual" | "auto";
    required_reviewers: string[];
    min_score: number;
    auto_send: boolean;
  };
  delivery: {
    sending_mode: "draft" | "direct";
    max_per_hour: number;
    max_per_day: number;
    permitted_hours: { start: number; end: number };
    suppression_list: string[];
  };
  revision: {
    max_cycles: number;
  };
}
