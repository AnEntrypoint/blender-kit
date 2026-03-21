'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { findBlender } = require('../lib/engine');

function isSingleExpr(code) {
	const t = code.trim();
	return !t.includes('\n') && !/\b(import|def|class|if|for|while|with|return|try|except|raise|from)\b/.test(t);
}

function httpPost(port, urlPath, body) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const opts = {
			hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
		};
		const req = http.request(opts, (res) => {
			let raw = '';
			res.on('data', c => { raw += c; });
			res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); } });
		});
		req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
		req.on('error', reject);
		req.write(data);
		req.end();
	});
}

async function run(code, cwd) {
	try {
		if (isSingleExpr(code)) {
			try {
				const res = await httpPost(6009, '/eval', { expr: code.trim() });
				return String(res.result !== undefined ? res.result : res.raw || JSON.stringify(res));
			} catch (_) {}
		}
		// Headless fallback
		const blender = findBlender(null);
		if (!blender) return 'Error: Blender not found. Set blenderPath in ~/.blender-kit/config.json';

		const tmp = path.join(os.tmpdir(), `blender_exec_${Date.now()}.py`);
		fs.writeFileSync(tmp, code.trim() + '\n');
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), 10000);
		try {
			const out = execFileSync(blender, ['--background', '--python', tmp], {
				cwd, signal: ac.signal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
			});
			return out;
		} finally {
			clearTimeout(timer);
			try { fs.unlinkSync(tmp); } catch (_) {}
		}
	} catch (e) {
		return String(e.message || e);
	}
}

function check(code, cwd) {
	const tmp = path.join(os.tmpdir(), `flake8_${Math.random().toString(36).slice(2)}.py`);
	try {
		fs.writeFileSync(tmp, code);
		let out = '';
		try { execFileSync('flake8', [tmp], { encoding: 'utf8' }); } catch (e) { out = e.stdout || e.message || ''; }
		return out.split('\n').reduce((acc, line) => {
			// flake8 format: filename:line:col: Exxx message
			const m = line.match(/^.+:(\d+):(\d+):\s+([EWC]\d+)\s+(.+)$/);
			if (m) {
				const code = m[3];
				acc.push({
					line: parseInt(m[1]),
					col: parseInt(m[2]),
					severity: code.startsWith('E') ? 'error' : 'warning',
					message: `${code} ${m[4].trim()}`
				});
			}
			return acc;
		}, []);
	} catch (_) {
		return [];
	} finally {
		try { fs.unlinkSync(tmp); } catch (_) {}
	}
}

module.exports = {
	id: 'blender',
	extensions: ['.py'],
	exec: {
		match: /^exec:blender/,
		run,
	},
	lsp: { check },
	context: `=== Blender exec: support ===
exec:blender
<python expression or script>

Single expressions run via HTTP bridge (port 6009, requires Blender open + blender_bridge addon enabled).
Multi-line scripts run headlessly via blender --background --python.
Requires: Blender installed and blenderPath set in ~/.blender-kit/config.json`,
};
