"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/authz";

/**
 * The signed-in user's role, provided once by the layout so client components
 * can decide which controls to render. This only shapes the UI — every gated
 * server action re-checks the role against the database on its own.
 *
 * The default is "collaborator" so a component rendered outside the provider
 * fails toward showing less, never more.
 */
const RoleContext = createContext<Role>("collaborator");

export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

export function useIsAdmin(): boolean {
  return useRole() === "admin";
}
