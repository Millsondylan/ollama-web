'use strict';

const http = require('http');

function startMockOllama({ port = 11434, streamDelayMs = 50 } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          models: [
            { name: 'mock-model', size: 1024, digest: 'mock-digest', modified_at: new Date().toISOString() },
            { name: 'mock-model thinking', size: 1536, digest: 'mock-digest-thinking', modified_at: new Date().toISOString() }
          ]
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/api/generate') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        let payload = {};
        try {
          payload = JSON.parse(body || '{}');
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid json' }));
          return;
        }

        const text = payload.prompt || 'default response';

        if (payload.stream) {
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          });

          const chunks = ['{"response":"mock token 1"}\n', '{"response":" mock token 2"}\n', '{"done":true}\n'];
          for (const chunk of chunks) {
            res.write(chunk);
            await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
          }
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            response: `mock completion for: ${text}`,
            done: true
          })
        );
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[mock-ollama] listening on ${port}`);
      resolve({
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
          })
      });
    });
  });
}

module.exports = { startMockOllama };

