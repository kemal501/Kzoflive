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

export const triggerImpact = (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') => {
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
