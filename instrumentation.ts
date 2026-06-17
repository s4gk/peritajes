export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Arranca el loop de recordatorios de cita (24h/2h antes). Antes se
    // disparaba desde el auto-connect de Baileys; con Meta-only no hay sockets
    // que reconectar, así que lo lanzamos directamente al boot.
    const { startReminderLoop } = await import(
      "./lib/server/whatsapp-reminders"
    );
    startReminderLoop();
  }
}
