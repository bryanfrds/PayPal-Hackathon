"use client";

// The pieces around AG Studio's own AI panel on Insights: where it sits, its wording, and the
// roster showing Nudge working with Studio's agents (Studio's panel lists only the agent you talk to).

import type { AgPanelConfig, AgStudioLocaleText } from "ag-studio";

/**
 * View mode with Studio's AI panel on the right. Studio's types list the AI panel for edit mode
 * only, but its panel code places it in either mode, so this stays in view mode: the owner reads
 * the dashboard, and only Nudge (through Studio's agents) changes it.
 */
export const NUDGE_PANELS = { view: { left: [], right: ["ai"] } } as unknown as AgPanelConfig;

export const NUDGE_LOCALE_TEXT: AgStudioLocaleText = {
  panelTitleAi: "Nudge",
  aiMessageInputPlaceholder: "Ask Nudge about your tabs…",
  aiNewChat: "New chat",
  aiNewConversation: "New chat",
  aiThinkingIndicator: "Nudge is thinking…",
} as AgStudioLocaleText;

/** Studio's agents as the roster names them: short and plain. */
const HELPERS = ["Builder", "Query", "Layout", "Widget", "Planner"];

/** Nudge, plus the dashboard helpers it hands chart and layout work to. Sits under the panel's title. */
export function NudgeRoster() {
  return (
    <div className="nudge-roster">
      <span className="nudge-roster-on">Nudge</span>
      <span className="nudge-roster-label">Dashboard helpers:</span>
      <ul aria-label="Dashboard helpers">
        {HELPERS.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
