import { colourIndex, initials } from "@/lib/home";

// Soft avatar colours; a name always gets the same one.
const AVATAR_COLOURS = [
  ["#fde8df", "#b4441f"],
  ["#e3ecfb", "#2f55c4"],
  ["#e6f3ea", "#2b7a46"],
  ["#f6efdc", "#8c6512"],
  ["#efe6f8", "#6b3fa0"],
  ["#e0f2f1", "#1d6f69"],
] as const;

/** A customer's initials in their colour. Decorative: the name is always shown next to it. */
export default function Avatar({ name, className = "avatar" }: { name: string; className?: string }) {
  const [bg, fg] = AVATAR_COLOURS[colourIndex(name, AVATAR_COLOURS.length)];
  return (
    <span className={className} style={{ background: bg, color: fg }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
