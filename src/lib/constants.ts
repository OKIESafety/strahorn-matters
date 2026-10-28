export const CONFIDENCE = [
  { value: "confirmed", label: "Confirmed", hint: "Their own text or direct documents" },
  { value: "corroborated", label: "Corroborated", hint: "Backed by multiple independent sources" },
  { value: "reported", label: "Reported", hint: "Witnessed or reported, not yet documented" },
  { value: "disputed", label: "Disputed", hint: "The parties give different accounts" },
  { value: "needs_review", label: "Needs review", hint: "Not yet checked against the source" },
] as const;

export type Confidence = (typeof CONFIDENCE)[number]["value"];
export const CONFIDENCE_VALUES = CONFIDENCE.map((c) => c.value) as [Confidence, ...Confidence[]];

export const SUGGESTED_TAGS = [
  "late exchange",
  "missed exchange",
  "parenting time",
  "medical",
  "school",
  "activities",
  "supervision",
  "work conflict",
  "communication",
  "belongings",
  "expenses",
  "50/50",
];

export const EVIDENCE_KINDS = [
  "photo",
  "screenshot",
  "document",
  "text_export",
  "audio",
  "video",
  "email",
  "other",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  contributor: "Contributor",
  reviewer: "Reviewer (read + comment)",
};

export const TIME_ZONE = "America/Chicago";
