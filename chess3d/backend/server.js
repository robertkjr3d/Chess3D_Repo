import express from "express";
import http from "http";
import { Server } from "socket.io";
import Database from 'better-sqlite3';
import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Use PostgreSQL if DATABASE_URL is set (production), otherwise SQLite (local dev)
const usePostgres = !!process.env.DATABASE_URL;
let db, pgPool;

if (usePostgres) {
  console.log('Using PostgreSQL database');
  console.log('DATABASE_URL present:', !!process.env.DATABASE_URL);
  try {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // Create table in PostgreSQL
    await pgPool.query(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      state TEXT,
      status TEXT,
      ownerToken TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )`);
    console.log('PostgreSQL connected and table created');
  } catch (err) {
    console.error('PostgreSQL connection error:', err);
    throw err;
  }
} else {
  console.log('Using SQLite database (local dev)');
  const DB_PATH = path.join(process.cwd(), 'games.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.prepare(`CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    state TEXT,
    status TEXT,
    ownerToken TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`).run();
  console.log('SQLite database initialized');
}

// Root route
app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    message: 'Chess3D Backend API',
    endpoints: {
      health: '/health',
      games: '/api/games'
    }
  });
});

app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.send('OK');
});

// Create a new game or update if id provided and ownerToken matches
app.post('/api/games', async (req, res) => {
  try {
    const { id, state, ownerToken } = req.body || {};
    const now = new Date().toISOString();
    if (id) {
      let row;
      if (usePostgres) {
        const result = await pgPool.query('SELECT * FROM games WHERE id = $1', [id]);
        row = result.rows[0];
      } else {
        row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
      }
      if (!row) return res.status(404).json({ error: 'not found' });
      if (row.ownertoken && ownerToken && row.ownertoken !== ownerToken) return res.status(403).json({ error: 'forbidden' });
      if (usePostgres) {
        await pgPool.query('UPDATE games SET state = $1, updatedAt = $2 WHERE id = $3', [JSON.stringify(state), now, id]);
      } else {
        db.prepare('UPDATE games SET state = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(state), now, id);
      }
      return res.json({ id, ownerToken: row.ownertoken, updatedAt: now });
    }
    const newId = randomUUID();
    const newOwner = randomUUID();
    if (usePostgres) {
      await pgPool.query('INSERT INTO games(id, state, status, ownerToken, createdAt, updatedAt) VALUES($1,$2,$3,$4,$5,$6)', [newId, JSON.stringify(state || {}), 'active', newOwner, now, now]);
    } else {
      db.prepare('INSERT INTO games(id, state, status, ownerToken, createdAt, updatedAt) VALUES(?,?,?,?,?,?)').run(newId, JSON.stringify(state || {}), 'active', newOwner, now, now);
    }
    return res.json({ id: newId, ownerToken: newOwner });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/games/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let row;
    if (usePostgres) {
      const result = await pgPool.query('SELECT * FROM games WHERE id = $1', [id]);
      row = result.rows[0];
    } else {
      row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
    }
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.json({ id: row.id, state: JSON.parse(row.state || '{}'), status: row.status, ownerToken: row.ownertoken || row.ownerToken, createdAt: row.createdat || row.createdAt, updatedAt: row.updatedat || row.updatedAt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/games/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { state, ownerToken, status } = req.body || {};
    let row;
    if (usePostgres) {
      const result = await pgPool.query('SELECT * FROM games WHERE id = $1', [id]);
      row = result.rows[0];
    } else {
      row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
    }
    if (!row) return res.status(404).json({ error: 'not found' });
    const rowOwnerToken = row.ownertoken || row.ownerToken;
    if (rowOwnerToken && ownerToken && rowOwnerToken !== ownerToken) return res.status(403).json({ error: 'forbidden' });
    const now = new Date().toISOString();
    if (usePostgres) {
      await pgPool.query('UPDATE games SET state = $1, status = $2, updatedAt = $3 WHERE id = $4', [JSON.stringify(state || {}), status || row.status, now, id]);
    } else {
      db.prepare('UPDATE games SET state = ?, status = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(state || {}), status || row.status, now, id);
    }
    return res.json({ id, updatedAt: now });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chess3D backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
});

