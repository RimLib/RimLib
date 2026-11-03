import { ShieldCheck } from "lucide-react";

export function OfficialMarker() {
  return (
    <span className="official-marker" title="Official RimWorld content">
      <ShieldCheck size={13} aria-hidden />
      Core
    </span>
  );
}
