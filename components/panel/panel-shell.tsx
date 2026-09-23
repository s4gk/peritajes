"use client";

import * as React from "react";

import { OfflineWarmup } from "@/components/shared/offline-warmup";
import { UIPreferencesProvider } from "@/components/wizard/ui-preferences";

import {
  CurrentUserProvider,
  type PanelUser as CurrentPanelUser,
} from "./current-user";
import { OrgFeaturesProvider, type OrgFeatures } from "./org-features";
import { SignatureGate } from "./signature-gate";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ProductTour } from "./tour/product-tour";

export type PanelUser = CurrentPanelUser;

export function PanelShell({
  user,
  features,
  children,
}: {
  user: PanelUser;
  features: OrgFeatures;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <CurrentUserProvider user={user}>
      <OrgFeaturesProvider features={features}>
        <UIPreferencesProvider>
          <div className="flex min-h-screen bg-muted/30">
            <Sidebar user={user} open={open} onClose={() => setOpen(false)} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar user={user} onMenuClick={() => setOpen(true)} />
              <main className="flex-1 px-4 sm:px-6 lg:px-12 xl:px-20">
                <SignatureGate user={user}>{children}</SignatureGate>
              </main>
            </div>
            <ProductTour setDrawerOpen={setOpen} />
            <OfflineWarmup userId={user.id} />
          </div>
        </UIPreferencesProvider>
      </OrgFeaturesProvider>
    </CurrentUserProvider>
  );
}
