import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { observePreview } from "../preview-observer";

type ProtectedImageProps = {
  readonly alt: string;
  readonly className?: string;
  readonly draggable?: boolean;
  readonly path: string;
  readonly style?: CSSProperties;
};

export const ProtectedImage = ({ alt, className, draggable, path, style }: ProtectedImageProps) => {
  const placeholder = useRef<HTMLSpanElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const image = useQuery({
    enabled: nearViewport,
    queryFn: () => api.download(path),
    queryKey: ["protected-image", path],
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    const element = placeholder.current;
    if (element === null || nearViewport) {
      return;
    }
    return observePreview(element, () => setNearViewport(true));
  }, [nearViewport]);

  useEffect(() => {
    if (image.data === undefined) {
      return;
    }
    const objectUrl = URL.createObjectURL(image.data);
    setSource(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setSource(null);
    };
  }, [image.data]);

  if (source === null) {
    if (image.isError) {
      return (
        <span
          aria-label={`${alt} preview unavailable`}
          className="image-skeleton image-error"
          ref={placeholder}
          role="img"
        />
      );
    }
    return (
      <span aria-label={`Loading ${alt}`} className="image-skeleton" ref={placeholder} role="img" />
    );
  }
  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      draggable={draggable}
      loading="lazy"
      src={source}
      style={style}
    />
  );
};
