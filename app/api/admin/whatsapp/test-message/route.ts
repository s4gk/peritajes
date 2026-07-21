import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  activeProvider,
  isMessagingConfigured,
  sendFreeText,
} from "@/lib/server/messaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth(e: unknown) {
  const msg = e instanceof Error ? e.message : "ERROR";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return unauth(e);
  }
  if (user.role === "employee") {
    return NextResponse.json(
      { error: "Solo el dueño puede mandar mensajes de prueba." },
      { status: 403 },
    );
  }

  if (!isMessagingConfigured()) {
    const provider = activeProvider();
    return NextResponse.json(
      {
        error:
          provider === "twilio"
            ? "WhatsApp (Twilio) no está configurado. Define TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y un sender."
            : provider === "kapso"
              ? "WhatsApp (Kapso) no está configurado. Define KAPSO_API_KEY y KAPSO_PHONE_NUMBER_ID."
              : "WhatsApp (Meta) no está configurado. Define META_WA_TOKEN y META_WA_PHONE_NUMBER_ID.",
      },
      { status: 400 },
    );
  }

  // Enviamos un texto libre al wa_phone del actor. Requiere que ese número
  // haya escrito al número empresarial en las últimas 24 h para que Meta
  // permita la respuesta libre (ventana de servicio).
  const phone = user.waPhone?.trim();
  if (!phone) {
    return NextResponse.json(
      {
        error:
          "Configura tu teléfono de WhatsApp en Mi cuenta para poder enviar el mensaje de prueba.",
      },
      { status: 400 },
    );
  }
  try {
    await sendFreeText(
      phone,
      [
        "✅ *Prueba de Perito (API Oficial)*",
        "",
        "Si recibes este mensaje, la integración con la API oficial de WhatsApp está funcionando correctamente.",
        "Los mensajes de notificación (link de firma, PDF, recordatorios) se enviarán por este canal.",
      ].join("\n"),
    );
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      {
        error: msg.includes("131047")
          ? "El número destino no ha iniciado conversación con el número empresarial en las últimas 24 h. Escríbele primero desde tu WhatsApp personal y vuelve a intentarlo."
          : msg,
      },
      { status: 400 },
    );
  }
  await logAudit(user.id, "whatsapp.test_sent", user.orgId ?? "meta");
  return NextResponse.json({ ok: true, phone });
}
