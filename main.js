require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios');

const {
  API_KEY,
  BASE_URL,
  PORT = 3000,
  RUBO_TOKEN,
  ALLOWED_ORIGINS = '',
} = process.env;

if (!API_KEY || !BASE_URL) {
  console.error('Missing required env: API_KEY, BASE_URL');
  process.exit(1);
}

if (!RUBO_TOKEN) {
  console.error('Missing required env: RUBO_TOKEN — generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}


// mode 含义：roast=锐评 / yinyang=阴阳 / accelerate=加速 / reply=包子帝回复 / chat=包子帝陪聊。
const MODE_PROMPTS = {
  roast: process.env.PROMPT_ROAST || '',
  yinyang: process.env.PROMPT_YINYANG || '',
  accelerate: process.env.PROMPT_ACCELERATE || '',
  reply: process.env.PROMPT_REPLY || '',
  chat: process.env.PROMPT_CHAT || '',
};

const app = express();

// ── Security headers ──
app.use(helmet());

// ── CORS ──
const originsSet = new Set(
  ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
);

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (e.g. curl, server-to-server)
    // In production, remove this to be stricter
    if (!origin || originsSet.has(origin) || originsSet.has('*')) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Rubo-Token'],
}));

// ── Body parser with size limit ──
app.use(express.json({ limit: '10kb' }));

// ── Auth middleware ──
function requireToken(req, res, next) {
  const token = req.headers['x-rubo-token'];
  if (token !== RUBO_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ── Chat endpoint ──
app.post('/api/chat', requireToken, async (req, res) => {
  const { query, conversationId = '', userId = 'rubo_user', mode = '' } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  if (query.length > 5000) {
    return res.status(400).json({ error: 'query too long (max 5000 chars)' });
  }


  // 口吻由前端显式传入：roast / yinyang / accelerate / reply（reply=亲自回复=
  // 包子帝，推文栏"AI 回复"按钮和右键菜单发送）。前端会话记住自己的 mode，追问时
  // 一并带上，故多轮口吻一致。无 mode（输入框裸打字的新会话）→ 空 → 中立。
  const modePrompt = MODE_PROMPTS[mode] || '';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Abort the upstream request if the client goes away (closes the side
  // panel, navigates off, hits stop). Without this the upstream stream keeps
  // running — holding the connection and burning tokens — until it times out.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const upstreamRes = await axios({
      method: 'post',
      url: `${BASE_URL}/chat-messages`,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      data: {
        inputs: { mode_prompt: modePrompt },
        query,
        response_mode: 'streaming',
        conversation_id: conversationId,
        user: userId,
      },
      responseType: 'stream',
      timeout: 60_000,
      signal: controller.signal,
    });

    // pipe() handles backpressure and ends the response when the upstream
    // stream finishes — no manual 'data'/'end' wiring (which risked writing
    // after res.end()).
    upstreamRes.data.pipe(res);
    upstreamRes.data.on('error', () => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ event: 'error', message: 'Upstream connection lost' })}\n\n`);
        res.end();
      }
    });
  } catch (err) {
    if (controller.signal.aborted || res.writableEnded) return; // client already gone

    const status = err.response?.status;
    let message = 'AI service temporarily unavailable';
    if (status === 429) message = 'AI service rate limited, please wait';
    else if (status >= 500) message = 'AI service error, please retry';

    res.write(`data: ${JSON.stringify({ event: 'error', message })}\n\n`);
    res.end();
  }
});

// ── 404 ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ──
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large (max 10KB)' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──
const server = app.listen(PORT, () => {
  console.log(`Rubo AI backend running on http://localhost:${PORT}`);
  console.log(`  POST /api/chat   — AI chat (SSE, auth required)`);
  console.log(`  GET  /health     — health check`);
  console.log(`  CORS origins     — ${ALLOWED_ORIGINS || '(none, will reject browser requests)'}`);
});

// ── Graceful shutdown ──
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} received, shutting down…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  });
}
