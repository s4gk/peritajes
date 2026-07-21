// Custom server para correr Next en HTTPS sobre el puerto de prod (3100).
//
// Por qué: `next start` no tiene HTTPS nativo en 14.x — solo `next dev` lo
// soporta vía --experimental-https. Para que los browsers permitan getUserMedia
// (cámara) la conexión tiene que ser secure-context, así que envolvemos Next
// con node:https usando los certs de mkcert en `certificates/`.
//
// Además, en el MISMO puerto atendemos HTTP plano y lo redirigimos a HTTPS.
// Razón: si alguien escribe `IP:3100` (o `http://IP:3100`), el navegador manda
// HTTP plano contra el socket TLS y la conexión se aborta (ERR_CONNECTION_ABORTED
// / "Empty reply from server"). Con el demux detectamos el primer byte del socket
// (0x16 = handshake TLS) y mandamos cada conexión al server que corresponde;
// el HTTP plano recibe un 301 hacia el mismo host en https.
//
// Levanta con `npm run start:https` (o vía pm2 apuntando a este archivo).
// Vars: PORT (default 3100), HOSTNAME (default 0.0.0.0).

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { createServer: createHttpsServer } = require("node:https");
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

  // Server HTTPS real que atiende la app.
  const httpsServer = createHttpsServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  // Server HTTP plano: solo redirige al equivalente https (mismo host y path).
  const httpRedirectServer = http.createServer((req, res) => {
    const host = req.headers.host || `${hostname}:${port}`;
    const location = `https://${host}${req.url || "/"}`;
    res.writeHead(301, { Location: location, Connection: "close" });
    res.end(`Redirigiendo a ${location}\n`);
  });

  // Demux en TCP crudo: mira el primer byte para decidir TLS vs HTTP plano.
  // 0x16 (22) es el tipo de record "Handshake" con el que arranca todo TLS.
  const demux = net.createServer((socket) => {
    socket.once("data", (buf) => {
      const target = buf[0] === 0x16 ? httpsServer : httpRedirectServer;
      socket.pause();
      target.emit("connection", socket);
      socket.unshift(buf); // devolvemos el byte espiado para que lo parsee el server
      socket.resume();
    });
    // Sockets sin datos (health checks TCP, etc.) se cierran solos al desconectar.
    socket.on("error", () => socket.destroy());
  });

  demux.listen(port, hostname, () => {
    console.log(`> Perito listo en https://${hostname}:${port} (http→https en el mismo puerto)`);
  });
});
