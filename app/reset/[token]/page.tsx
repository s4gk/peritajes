import { getLiveResetToken } from "@/lib/server/password-reset";

import { ResetClient } from "./reset-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ResetPage({
  params,
}: {
  params: { token: string };
}) {
  const info = await getLiveResetToken(params.token);

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-2xl">
            ⏱️
          </div>
          <h1 className="text-lg font-semibold">Enlace inválido o vencido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este link de reset no es válido. Pedile al administrador que genere uno
            nuevo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ResetClient
      token={params.token}
      fullName={info.fullName}
      username={info.username}
    />
  );
}
