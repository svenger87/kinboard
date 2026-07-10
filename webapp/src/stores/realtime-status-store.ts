import { create } from "zustand";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

interface RealtimeStatusState {
  status: RealtimeStatus;
  setStatus: (status: RealtimeStatus) => void;
}

export const useRealtimeStatusStore = create<RealtimeStatusState>((set) => ({
  status: "connecting",
  setStatus: (status) => set({ status }),
}));
