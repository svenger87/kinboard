import { create } from "zustand";
import type { ScreenRequest } from "@/lib/home/action-requests";

/**
 * What the assistant prompt keeps on screen after a request has left the
 * pending list: the outcome of an approval ("Allowed, and done."), or an
 * error that ended the request. Shown until someone closes it.
 *
 * A store rather than the overlay's own state because the screensaver gate
 * (app/providers.tsx) must see it too: a notice nobody has read is not
 * covered by a slideshow. `messageKey` is an `assistantActions` key,
 * translated where it is shown.
 */
export interface AssistantActionNotice {
  request: ScreenRequest;
  messageKey: string;
}

interface NoticeState {
  notices: AssistantActionNotice[];
  show: (notice: AssistantActionNotice) => void;
  dismiss: (requestId: string) => void;
}

export const useAssistantActionNotices = create<NoticeState>((set) => ({
  notices: [],
  // One notice per request: a newer word on the same request replaces the old.
  show: (notice) =>
    set((s) => ({ notices: [...s.notices.filter((n) => n.request.id !== notice.request.id), notice] })),
  dismiss: (requestId) => set((s) => ({ notices: s.notices.filter((n) => n.request.id !== requestId) })),
}));
