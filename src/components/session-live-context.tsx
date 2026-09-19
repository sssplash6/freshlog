"use client";

import { createContext, useContext, useState } from "react";

import type { SessionEntry } from "@/components/session-row";
import type { SessionUpdate } from "@/lib/actions/shared";

type SessionLiveContextValue = {
  session: SessionEntry;
  update: (patch: SessionUpdate) => void;
};

const SessionLiveContext = createContext<SessionLiveContextValue | null>(null);

export function SessionLiveProvider({
  initialSession,
  children,
}: {
  initialSession: SessionEntry;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState(initialSession);
  return (
    <SessionLiveContext.Provider
      value={{
        session,
        update: (patch) =>
          setSession((current) => ({
            ...current,
            ...patch,
            date: new Date(patch.date),
          })),
      }}
    >
      {children}
    </SessionLiveContext.Provider>
  );
}

export function useLiveSession() {
  return useContext(SessionLiveContext);
}
