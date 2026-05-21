// Custom server para correr Next en HTTPS sobre el puerto de prod (3100).
//
// Por qué: `next start` no tiene HTTPS nativo en 14.x — solo `next dev` lo
// soporta vía --experimental-https. Para que los browsers permitan getUserMedia
// (cámara) la conexión tiene que ser secure-context, así que envolvemos Next
// con node:https usando los certs de mkcert en `certificates/`.
//
// Levanta con `npm run start:https` (o vía pm2 apuntando a este archivo).
// Vars: PORT (default 3100), HOSTNAME (default 0.0.0.0).

const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("node:https");
const { parse } = require("node:url");
const next = require("next");

const port = parseInt(process.env.PORT || "3100", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

const certDir = path.join(__dirname, "certificates");
const certPath = path.join(certDir, "perito.pem");
const keyPath = path.join(certDir, "perito-key.pem");

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error(
    `[server] Cert o key no encontrados en ${certDir}.\n` +
      `Generá con: /root/.cache/mkcert/mkcert-v1.4.4-linux-amd64 \\\n` +
      `  -cert-file certificates/perito.pem \\\n` +
      `  -key-file certificates/perito-key.pem \\\n` +
      `  localhost 127.0.0.1 <tu-IP>`,
  );
  process.exit(1);
}

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  }).listen(port, hostname, () => {
    console.log(`> Perito HTTPS listo en https://${hostname}:${port}`);
  });
});
