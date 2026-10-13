// The 555 Buku mark: a black notebook with spiral holes and "555". The app icons draw the
// same mark in app/components/appIcon.tsx; keep them matching.

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <span>555</span>
    </span>
  );
}

export default function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span>
        <span className="visually-hidden">555 </span>Buku
      </span>
    </span>
  );
}
