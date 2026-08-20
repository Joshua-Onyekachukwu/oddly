"use client";

import { useEffect, useRef, useState } from "react";

interface UseScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}

/**
 * IntersectionObserver-based scroll reveal hook.
 * Elements fade up with blur when entering viewport.
 * Uses GPU-safe transform + opacity only.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options: UseScrollRevealOptions = {}
) {
  const { threshold = 0.1, rootMargin = "0px 0px -60px 0px", once = true } = options;
  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) {
            observer.unobserve(element);
          }
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, isVisible };
}

/**
 * CSS class generator for scroll reveal animations.
 * All animations use transform + opacity only (GPU-safe).
 */
export function getScrollRevealClasses(isVisible: boolean, delay: number = 0) {
  return {
    className: `transition-all duration-[800ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
      isVisible
        ? "opacity-100 translate-y-0 blur-0"
        : "opacity-0 translate-y-10 blur-[4px]"
    }`,
    style: { transitionDelay: `${delay}ms` },
  };
}
