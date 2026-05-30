export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { autoConnectIfPersisted } = await import(
      "./lib/server/whatsapp"
    );
    await autoConnectIfPersisted();
  }
}
