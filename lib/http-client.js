'use strict';

const http = require('http');

const BRIDGE_PORT = 6009;

function request(port, method, urlPath, body, timeout, _retried) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ raw }); }
      });
    });
    req.setTimeout(timeout || 5000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        if (!_retried) {
          setTimeout(() => request(port, method, urlPath, body, timeout, true).then(resolve).catch(reject), 500);
          return;
        }
        reject(new Error(
          `Blender bridge not running on port ${port}. ` +
          `Enable the blender_bridge addon in Blender (Edit > Preferences > Add-ons) ` +
          `and ensure Blender is open.`
        ));
      } else if (e.code === 'ETIMEDOUT' || e.message === 'Request timed out') {
        reject(new Error(`Request to port ${port} timed out. Blender may be busy or unresponsive.`));
      } else {
        reject(new Error(e.message));
      }
    });
    if (data) req.write(data);
    req.end();
  });
}

const bridgeGet = (urlPath, timeout) => request(BRIDGE_PORT, 'GET', urlPath, null, timeout);
const bridgePost = (urlPath, body, timeout) => request(BRIDGE_PORT, 'POST', urlPath, body, timeout);

function ping(port, probePath) {
  return new Promise((resolve) => {
    const start = Date.now();
    const opts = { hostname: '127.0.0.1', port, path: probePath, method: 'GET' };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => { resolve({ ok: true, latencyMs: Date.now() - start, raw }); });
    });
    req.setTimeout(1500, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    req.end();
  });
}

const pingBridge = () => ping(BRIDGE_PORT, '/info');

module.exports = { bridgeGet, bridgePost, pingBridge, BRIDGE_PORT };
