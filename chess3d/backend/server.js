import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

app.get("/health", (req, res) => {
  res.send("OK");
});

server.listen(3001, () => {
  console.log("Chess3D backend running on port 3001");
});

const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
});

