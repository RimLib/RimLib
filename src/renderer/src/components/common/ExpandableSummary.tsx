import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";

const collapsedSummaryCharacterLimit = 240;

export function ExpandableSummary({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);
  const summaryId = useId();
  const expandable = summary.length > collapsedSummaryCharacterLimit;

  return (
    <div className="summary-block">
      <p id={summaryId} className={expandable && !expanded ? "summary summary-clamped" : "summary"}>
        {summary}
      </p>
      {expandable && (
        <button
          type="button"
          className="summary-toggle"
          aria-controls={summaryId}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse mod description" : "Expand mod description"}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}
