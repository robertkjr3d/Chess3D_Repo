import express from "express";
import http from "http";
import { Server } from "socket.io";
import Database from 'better-sqlite3';
import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import cors from 'cors';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const DB_PATH = path.join(process.cwd(), 'games.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.prepare(`CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  state TEXT,
  status TEXT,
  ownerToken TEXT,
  createdAt TEXT,
  updatedAt TEXT
)`).run();

app.get('/health', (req, res) => res.send('OK'));

// Create a new game or update if id provided and ownerToken matches
app.post('/api/games', (req, res) => {
  try {
    const { id, state, ownerToken } = req.body || {};
    const now = new Date().toISOString();
    if (id) {
      const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ error: 'not found' });
      if (row.ownerToken && ownerToken && row.ownerToken !== ownerToken) return res.status(403).json({ error: 'forbidden' });
      db.prepare('UPDATE games SET state = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(state), now, id);
      return res.json({ id, ownerToken: row.ownerToken, updatedAt: now });
    }
    const newId = randomUUID();
    const newOwner = randomUUID();
    db.prepare('INSERT INTO games(id, state, status, ownerToken, createdAt, updatedAt) VALUES(?,?,?,?,?,?)').run(newId, JSON.stringify(state || {}), 'active', newOwner, now, now);
    return res.json({ id: newId, ownerToken: newOwner });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/games/:id', (req, res) => {
  try {
    const id = req.params.id;
    const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.json({ id: row.id, state: JSON.parse(row.state || '{}'), status: row.status, ownerToken: row.ownerToken, createdAt: row.createdAt, updatedAt: row.updatedAt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/games/:id', (req, res) => {
  try {
    const id = req.params.id;
    const { state, ownerToken, status } = req.body || {};
    const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.ownerToken && ownerToken && row.ownerToken !== ownerToken) return res.status(403).json({ error: 'forbidden' });
    const now = new Date().toISOString();
    db.prepare('UPDATE games SET state = ?, status = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(state || {}), status || row.status, now, id);
    return res.json({ id, updatedAt: now });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
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

