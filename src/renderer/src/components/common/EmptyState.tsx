import { Archive } from "lucide-react";

interface EmptyStateProps {
  label: string;
}

export function EmptyState({ label }: EmptyStateProps) {
  return (
    <div className="grid min-h-40 place-items-center content-center gap-2.5 font-bold text-[#8895a4]">
      <Archive size={24} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
