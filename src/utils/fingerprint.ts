export interface ClientInfo {
  userAgent: string;
  platform: string;
  languages: string[];
  screenSize: string;
  devicePixelRatio: number;
  cores: number;
  headless: boolean;
  isEmulator: boolean;
  vpnEnabled: boolean;
}

export function captureClientInfo(): ClientInfo {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const languages = [...(navigator.languages || [])];
  const size = `${window.screen.width}x${window.screen.height}`;
  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency || 2;

  // Headless browser detection triggers
  const isWebdriver = navigator.webdriver === true;
  const isHeadlessUA = /HeadlessChrome|PhantomJS|jsdom/i.test(ua);
  const isZeroSize = window.screen.width === 0 || window.screen.height === 0;
  const isHeadless = isWebdriver || isHeadlessUA || isZeroSize;

  // Emulator cues detection
  const isAndroidUA = /android/i.test(ua);
  const isMobilePlatform = /iPhone|iPad|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(platform);
  // Real touch capabilities check
  const supportsTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  // Flag emulators when showing mobile UA but missing touch interfaces or running on Mac/X11 platforms
  const isEmulator = (isAndroidUA && !supportsTouch) || 
                      (isMobilePlatform && /MacIntel|Win32|Linux x86_64/i.test(platform));

  // VPN Indicator (Language timezone code matching mock hook)
  const isVpn = languages.length === 0 || (languages[0]?.toLowerCase().includes('en') && Intl.DateTimeFormat().resolvedOptions().timeZone.includes('Asia'));

  return {
    userAgent: ua,
    platform,
    languages,
    screenSize: size,
    devicePixelRatio: dpr,
    cores,
    headless: isHeadless,
    isEmulator,
    vpnEnabled: isVpn
  };
}

export function generateFingerprint(): string {
  const info = captureClientInfo();
  const raw = `${info.platform}-${info.screenSize}-${info.cores}-${navigator.languages?.join(',')}`;
  
  // Easy browser hash function
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}
