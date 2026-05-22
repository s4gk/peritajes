"use client";

import * as React from "react";

export type PanelUser = {
  id: string;
  username: string;
  fullName: string;
  licenseId: string | null;
  signatureDataUrl: string | null;
  role: "admin" | "owner" | "employee";
};

const CurrentUserContext = React.createContext<PanelUser | null>(null);

export function CurrentUserProvider({
  user,
  children,
}: {
  user: PanelUser;
  children: React.ReactNode;
}) {
  return (
    <CurrentUserContext.Provider value={user}>
      {children}
    </CurrentUserContext.Provider>
  );
}

/**
 * Returns the user the panel was rendered for. Returns null when used outside
 * the panel layout (e.g. on /login or /setup) — callers should treat that as
 * "unauthenticated for restriction purposes" and hide admin-only affordances.
 */
export function useCurrentUser(): PanelUser | null {
  return React.useContext(CurrentUserContext);
}

export function useIsAdmin(): boolean {
  return useCurrentUser()?.role === "admin";
}
