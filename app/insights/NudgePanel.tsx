"use client";

// The pieces around AG Studio's own AI panel on Insights: where it sits, its wording, and the
// roster showing Nudge working with Studio's agents (Studio's panel lists only the agent you talk to).

import type { AgPanelConfig, AgStudioLocaleText } from "ag-studio";
import { translator, type T } from "@/lib/i18n";
import { useT } from "../useT";

/**
 * View mode with Studio's AI panel on the right. Studio's types list the AI panel for edit mode
 * only, but its panel code places it in either mode, so this stays in view mode: the owner reads
 * the dashboard, and only Nudge (through Studio's agents) changes it.
 */
export const NUDGE_PANELS = { view: { left: [], right: ["ai"] } } as unknown as AgPanelConfig;

/** Our wording for Studio's AI panel. Studio's other built-in text stays in English. */
export function nudgeLocaleText(t: T = translator()): AgStudioLocaleText {
  return {
    panelTitleAi: "Nudge",
    aiMessageInputPlaceholder: t("nudge.inputPlaceholder"),
    aiNewChat: t("nudge.newChat"),
    aiNewConversation: t("nudge.newChat"),
    aiThinkingIndicator: t("nudge.thinking"),
  } as AgStudioLocaleText;
}

/** Studio's agents as the roster names them: short and plain (names, so they stay as they are). */
const HELPERS = ["Builder", "Query", "Layout", "Widget", "Planner"];

/** Nudge, plus the dashboard helpers it hands chart and layout work to. Sits under the panel's title. */
export function NudgeRoster() {
  const { t } = useT();
  return (
    <div className="nudge-roster">
      <span className="nudge-roster-on">Nudge</span>
      <span className="nudge-roster-label">{t("nudge.helpersLabel")}</span>
      <ul aria-label={t("nudge.helpersAria")}>
        {HELPERS.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
