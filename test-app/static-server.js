import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5173;

// MIME types
app.use((req, res, next) => {
  if (req.url.endsWith('.wasm')) {
    res.type('application/wasm');
  } else if (req.url.endsWith('.js')) {
    res.type('application/javascript');
  }
  next();
});

// CORS headers for SharedArrayBuffer
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// Serve static files
app.use(express.static(__dirname));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use('/src', express.static(path.join(__dirname, '../src')));
app.use('/public', express.static(path.join(__dirname, '../public')));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('WASM files will be served with correct MIME type');
});