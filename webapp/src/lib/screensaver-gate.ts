/**
 * Whether the screensaver may cover the screen right now. It is right about
 * idleness and wrong about what idleness means while something needs a
 * person: a ringing timer, a message being said to the house, a camera put
 * on the wall because the doorbell rang (#335), or an
 * assistant waiting for someone to allow a door or an alarm (RFC-011 §4.3),
 * or the outcome of one somebody allowed and has not read yet —
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
  /** Outcomes and errors of assistant requests still on screen, unread. */
  assistantActionNotices?: number;
  /** A camera `show_camera` put on this screen and showing: not closed here, and the camera still set up. */
  cameraTakeover?: boolean;
}): boolean {
  return state.isIdle
    && !state.skipPath
    && !state.handheld
    && !state.ringingTimer
    && !state.takeoverMessage
    && state.pendingAssistantActions === 0
    && (state.assistantActionNotices ?? 0) === 0
    && !state.cameraTakeover;
}
