import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api";

type ProtectedImageProps = {
  readonly alt: string;
  readonly className?: string;
  readonly path: string;
};

export const ProtectedImage = ({ alt, className, path }: ProtectedImageProps) => {
  const image = useQuery({
    queryFn: () => api.download(path),
    queryKey: ["protected-image", path],
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [source, setSource] = useState<string | null>(null);

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
          role="img"
        />
      );
    }
    return <span aria-label={`Loading ${alt}`} className="image-skeleton" role="img" />;
  }
  return <img alt={alt} className={className} src={source} />;
};
