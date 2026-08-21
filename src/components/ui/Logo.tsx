"use client";

import React from "react";

interface LogoProps {
  src?: string | null;
  alt: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  rounded?: "full" | "md" | "lg";
}

const SIZE_MAP = {
  xs: "w-[20px] h-[20px]",
  sm: "w-[28px] h-[28px]",
  md: "w-[36px] h-[36px]",
  lg: "w-[48px] h-[48px]",
};

const RADIUS_MAP = {
  full: "rounded-full",
  md: "rounded-[6px]",
  lg: "rounded-[10px]",
};

const TEXT_SIZE_MAP = {
  xs: "text-[8px]",
  sm: "text-[10px]",
  md: "text-[12px]",
  lg: "text-[16px]",
};

export function Logo({
  src,
  alt,
  size = "sm",
  className = "",
  rounded = "full",
}: LogoProps) {
  const [imgError, setImgError] = React.useState(false);
  const [imgLoaded, setImgLoaded] = React.useState(false);

  // Reset error state when src changes
  React.useEffect(() => {
    setImgError(false);
    setImgLoaded(false);
  }, [src]);

  const initial = alt?.charAt(0)?.toUpperCase() || "?";
  const showImage = src && !imgError;

  return (
    <div
      className={`
        ${SIZE_MAP[size]} ${RADIUS_MAP[rounded]}
        bg-gray-100 flex items-center justify-center overflow-hidden flex-none
        ${className}
      `}
    >
      {showImage ? (
        <>
          {!imgLoaded && (
            <span className={`${TEXT_SIZE_MAP[size]} font-bold text-gray-400 font-display`}>
              {initial}
            </span>
          )}
          <img
            src={src}
            alt={alt}
            className={`w-full h-full object-contain ${imgLoaded ? "" : "hidden"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        </>
      ) : (
        <span className={`${TEXT_SIZE_MAP[size]} font-bold text-gray-400 font-display`}>
          {initial}
        </span>
      )}
    </div>
  );
}

/**
 * Team logo with proper styling.
 */
export function TeamLogo({
  src,
  name,
  size = "sm",
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <Logo
      src={src}
      alt={name}
      size={size}
      rounded="full"
      className={className}
    />
  );
}

/**
 * League logo with proper styling.
 */
export function LeagueLogo({
  src,
  name,
  size = "sm",
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <Logo
      src={src}
      alt={name}
      size={size}
      rounded="md"
      className={className}
    />
  );
}
