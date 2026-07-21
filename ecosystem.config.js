// Config de pm2 para producción.
//
// OJO: este archivo está versionado en git — NO poner secretos acá.
// DATABASE_URL, OPENAI_API_KEY, META_WA_* y demás credenciales viven en
// `.env.local` (chmod 600, fuera de git), que Next carga automáticamente al
// inicializar en server.js. Ver `.env.example` para la lista completa.
module.exports = {
  apps: [
    {
      name: "perito",
      script: "server.js",
      cwd: "/home/dev/perito",
      // instances: 1 es OBLIGATORIO por ahora, no una preferencia:
      //  - ensureMigrated() (lib/server/db.ts) no toma advisory lock, así que
      //    N procesos migrando a la vez pueden deadlockear.
      //  - el rate limit (lib/server/rate-limit.ts) es en memoria por proceso.
      //  - el loop de recordatorios (lib/server/whatsapp-reminders.ts) se
      //    duplicaría y mandaría el mismo WhatsApp N veces.
      instances: 1,
      autorestart: true,
      watch: false,
      // Puppeteer levanta un Chrome por PDF; si algo se fuga, reciclamos.
      max_memory_restart: "1500M",
      // Un render de PDF puede tardar ~60s: no lo mates a mitad de camino.
      kill_timeout: 15000,
      env: {
        NODE_ENV: "production",
        PORT: "3100",
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
