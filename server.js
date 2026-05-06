const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs/promises');
const path = require('path');
const next = require('next');

dotenv.config();

const repoRoot = path.resolve(__dirname, '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const storeFilePath = path.join(__dirname, 'data', 'app-store.json');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const externalUrl = process.env.RENDER_EXTERNAL_URL;

const allowedOrigins = new Set(
  [
    externalUrl ? new URL(externalUrl).origin : null,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ].filter(Boolean),
);

const app = express();

app.set('trust proxy', 1);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

function getPublicOrigin(req) {
  if (externalUrl) {
    return externalUrl;
  }

  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'];

  if (typeof forwardedHost === 'string' && typeof forwardedProto === 'string') {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const hostHeader = req.headers.host;
  if (typeof hostHeader === 'string' && hostHeader) {
    return `http://${hostHeader}`;
  }

  return `http://localhost:${port}`;
}

async function readStore() {
  try {
    const raw = await fs.readFile(storeFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }

    return {};
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function writeStore(nextStore) {
  await fs.mkdir(path.dirname(storeFilePath), { recursive: true });
  await fs.writeFile(storeFilePath, JSON.stringify(nextStore, null, 2), 'utf8');
}

app.get('/api/status', (req, res) => {
  res.json({
    status: 'success',
    time: new Date().toISOString(),
    host,
    port,
    origin: getPublicOrigin(req),
  });
});

app.get('/api/store', async (req, res, next) => {
  try {
    const store = await readStore();
    res.json(store);
  } catch (error) {
    next(error);
  }
});

app.put('/api/store', async (req, res, next) => {
  try {
    const currentStore = await readStore();
    const patch = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const mergedStore = {
      ...currentStore,
      ...patch,
    };

    await writeStore(mergedStore);
    res.json(mergedStore);
  } catch (error) {
    next(error);
  }
});

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.use(async (req, res, next) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).json({
    error: 'Internal Server Error',
  });
});

let handleRequest = null;

async function start() {
  const nextApp = next({
    dev: false,
    dir: frontendRoot,
  });

  await nextApp.prepare();
  handleRequest = nextApp.getRequestHandler();

  app.listen(port, host, () => {
    console.log(`Server is running on ${host}:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
