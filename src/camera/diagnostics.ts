import type { Viewport } from "../types";
export function viewport(originX = 0, originY = 0): Viewport {
  const v = window.visualViewport;
  return {
    screenWidth: screen.width,
    screenHeight: screen.height,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    scale: v?.scale ?? 1,
    offsetLeft: v?.offsetLeft ?? 0,
    offsetTop: v?.offsetTop ?? 0,
    orientation:
      screen.orientation?.type ??
      (innerWidth > innerHeight ? "landscape-primary" : "portrait-primary"),
    originX,
    originY,
  };
}
export class Diagnostics {
  events: { time: string; elapsed: number; type: string; data: unknown }[] = [];
  event(type: string, data: unknown = null) {
    this.events.push({
      time: new Date().toISOString(),
      elapsed: performance.now(),
      type,
      data: structuredClone(data),
    });
    if (this.events.length > 3000) this.events.shift();
  }
  snapshot() {
    const s = getComputedStyle(document.documentElement);
    return {
      timestamp: new Date().toISOString(),
      viewport: viewport(),
      visualViewport: visualViewport
        ? {
            width: visualViewport.width,
            height: visualViewport.height,
            offsetLeft: visualViewport.offsetLeft,
            offsetTop: visualViewport.offsetTop,
            scale: visualViewport.scale,
          }
        : null,
      visibility: document.visibilityState,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      secureContext: isSecureContext,
      safeArea: {
        top: s.getPropertyValue("--safe-top"),
        bottom: s.getPropertyValue("--safe-bottom"),
      },
      previewMirrored: true,
      inferenceMirrored: false,
      events: this.events,
    };
  }
}
