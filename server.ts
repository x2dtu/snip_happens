import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { registerRooms } from "./src/server/rooms";

const dev = process.env.NODE_ENV !== "production";
// Loopback by default. Hosting platforms (see render.yaml) set HOST=0.0.0.0 so their proxy can reach the container.
const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    handle(req, res);
  });
  const io = new Server(httpServer, { maxHttpBufferSize: 16 * 1024 });
  registerRooms(io);
  httpServer.listen(port, hostname, () => {
    console.log(`> Snip Happens ready on http://${hostname}:${port}`);
  });
});
