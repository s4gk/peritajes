import { NextResponse } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/db";
import {
  ADMIN_WA_ORG,
  sendSelfTestMessage,
} from "@/lib/server/whatsapp";
import {
  isMetaConfigured,
  sendMetaFreeText,
} from "@/lib/server/whatsapp-meta";

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

  // Cuando Meta está configurado enviamos un texto libre al wa_phone del
  // actor (requiere que el número destino haya escrito al número empresarial
  // en las últimas 24 h para que Meta permita la respuesta libre).
  if (isMetaConfigured()) {
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
      await sendMetaFreeText(
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

  // Baileys
  const orgId =
    user.orgId ?? (user.role === "admin" ? ADMIN_WA_ORG : null);
  if (!orgId) {
    return NextResponse.json(
      { error: "Necesitas una organización para mandar un mensaje de prueba." },
      { status: 400 },
    );
  }
  const r = sendSelfTestMessage(orgId);
  if (!r.accepted) {
    return NextResponse.json(
      { error: r.reason ?? "No se pudo encolar el mensaje" },
      { status: 400 },
    );
  }
  await logAudit(user.id, "whatsapp.test_sent", orgId);
  return NextResponse.json({ ok: true, phone: r.phone });
}
