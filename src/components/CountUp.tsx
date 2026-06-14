import { useEffect, useRef } from 'react';
import { animate } from 'motion/react';

interface CountUpProps {
  value: number;
}

export function CountUp({ value }: CountUpProps) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    // Determine the starting value of the animation:
    // It should be the previous value we were animating to or currently displaying.
    const startValue = prevValueRef.current;
    prevValueRef.current = value;

    const controls = animate(startValue, value, {
      duration: 1.0,
      ease: 'easeOut',
      onUpdate(v) {
        node.textContent = Math.floor(v).toLocaleString();
      },
    });

    return () => controls.stop();
  }, [value]);

  return <span ref={nodeRef}>{value.toLocaleString()}</span>;
}
