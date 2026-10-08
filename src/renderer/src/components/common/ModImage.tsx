import { Archive } from "lucide-react";
import { useState } from "react";

import { modImageUrl } from "../../utils/images";

export function ModImage({
  src,
  refreshedAt,
  size = 18,
  lazy = false,
}: {
  src?: string;
  refreshedAt?: string;
  size?: number;
  lazy?: boolean;
}) {
  const url = modImageUrl(src, refreshedAt);
  const [failedUrl, setFailedUrl] = useState<string>();
  return url && failedUrl !== url ? (
    <img
      src={url}
      alt=""
      loading={lazy ? "lazy" : undefined}
      onError={() => {
        setFailedUrl(url);
      }}
    />
  ) : (
    <Archive size={size} aria-hidden />
  );
}
