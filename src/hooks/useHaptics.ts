import { triggerImpact } from '../utils/haptic';

export const useHaptic = (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light') => {
  const triggerHaptic = () => {
    triggerImpact(style);
  };
  return triggerHaptic;
};
