import type { ReactNode } from "react";

interface PanelTitleProps {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}

export function PanelTitle({ icon, title, children }: PanelTitleProps) {
  return (
    <div className="flex min-h-[50px] items-center justify-between gap-3 border-b border-[#28313c] bg-[#171d25] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5 [&_svg]:shrink-0 [&_svg]:text-[#d7a84f]">
        {icon}
        <h2 className="truncate text-sm font-[760] text-[#edf2f7]">{title}</h2>
      </div>
      {children ? (
        <div className="flex shrink-0 gap-2 [&_.icon-button_svg]:text-current">{children}</div>
      ) : null}
    </div>
  );
}
