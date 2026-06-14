interface TelegramWebAppHapticFeedback {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}

interface TelegramWebApp {
  HapticFeedback?: TelegramWebAppHapticFeedback;
}

interface TelegramWindow extends Window {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}

const isHapticEnabled = (): boolean => {
  try {
    const val = localStorage.getItem('haptics_enabled');
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
};

export const triggerImpact = (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') => {
  if (!isHapticEnabled()) return;
  try {
    const tgWindow = window as unknown as TelegramWindow;
    const haptic = tgWindow.Telegram?.WebApp?.HapticFeedback;
    if (haptic && typeof haptic.impactOccurred === 'function') {
      haptic.impactOccurred(style);
    }
  } catch (error) {
    console.warn('Failed to trigger Telegram haptic feedback impactOccurred', error);
  }
};

export const triggerNotification = (type: 'success' | 'warning' | 'error') => {
  if (!isHapticEnabled()) return;
  try {
    const tgWindow = window as unknown as TelegramWindow;
    const haptic = tgWindow.Telegram?.WebApp?.HapticFeedback;
    if (haptic && typeof haptic.notificationOccurred === 'function') {
      haptic.notificationOccurred(type);
    }
  } catch (error) {
    console.warn('Failed to trigger Telegram haptic feedback notificationOccurred', error);
  }
};

export const triggerSelectionChange = () => {
  if (!isHapticEnabled()) return;
  try {
    const tgWindow = window as unknown as TelegramWindow;
    const haptic = tgWindow.Telegram?.WebApp?.HapticFeedback;
    if (haptic && typeof haptic.selectionChanged === 'function') {
      haptic.selectionChanged();
    }
  } catch (error) {
    console.warn('Failed to trigger Telegram haptic feedback selectionChanged', error);
  }
};
