/**
 * Whether the screensaver may cover the screen right now. It is right about
 * idleness and wrong about what idleness means while something needs a
 * person: a ringing timer, a message being said to the house, or an
 * assistant waiting for someone to allow a door or an alarm (RFC-011 §4.3) —
 * each of those arrives precisely when nobody is standing at the board, and
 * underneath a photo slideshow it would be missed.
 */
export function screensaverAllowed(state: {
  isIdle: boolean;
  skipPath: boolean;
  handheld: boolean;
  ringingTimer: boolean;
  takeoverMessage: boolean;
  pendingAssistantActions: number;
}): boolean {
  return state.isIdle
    && !state.skipPath
    && !state.handheld
    && !state.ringingTimer
    && !state.takeoverMessage
    && state.pendingAssistantActions === 0;
}
