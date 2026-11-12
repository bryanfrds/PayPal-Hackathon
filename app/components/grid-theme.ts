// Dark colours for our AG Grid tables (Home's board and the ledger), the mock's phone-4 palette.
// Each grid keeps its own light theme exactly as it was and swaps to these when dark is showing.

export const DARK_GRID_COLOURS = {
  foregroundColor: "#f2efe9",
  accentColor: "#f2efe9",
  backgroundColor: "#1d1d1c",
  borderColor: "#2c2b29",
  rowHoverColor: "#252523",
  browserColorScheme: "dark",
} as const;
