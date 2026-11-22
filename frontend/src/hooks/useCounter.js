import { useState, useEffect } from "react";

/**
 * Animates a number from 0 to `target` using requestAnimationFrame.
 * rAF is throttled to the display refresh rate, auto-batches with React 18,
 * and avoids the GC overhead of setInterval.
 */
export function useCounter(target, duration = 1200) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!target || target <= 0) return;

    let rafId;
    let startTime = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out: decelerate toward the end
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration]);

  return value;
}