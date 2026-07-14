"use client";

import { useEffect, useState } from "react";

interface SourceLogoProps {
  src: string | null;
  name: string | null;
  imgClassName: string;
  /**
   * When the image is missing or fails to load, the source name is rendered
   * with these classes. Omit to render nothing (hide) on fallback.
   */
  fallbackClassName?: string;
}

/**
 * Renders a source logo, gracefully falling back to the source name (or
 * nothing) when the image URL is empty or fails to load.
 */
export function SourceLogo({
  src,
  name,
  imgClassName,
  fallbackClassName,
}: SourceLogoProps): JSX.Element | null {
  const [broken, setBroken] = useState<boolean>(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? ""}
        onError={() => setBroken(true)}
        className={imgClassName}
      />
    );
  }

  if (!name || fallbackClassName === undefined) return null;
  return <span className={fallbackClassName}>{name}</span>;
}
