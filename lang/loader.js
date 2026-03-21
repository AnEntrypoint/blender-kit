'use strict';
const fs = require('fs');
const path = require('path');

function loadLangPlugins(projectDir) {
	const langDir = path.join(projectDir, 'lang');
	if (!fs.existsSync(langDir)) return [];
	const files = fs.readdirSync(langDir).filter(f => f.endsWith('.js') && f !== 'loader.js');
	return files.reduce((acc, f) => {
		try {
			const p = require(path.join(langDir, f));
			if (p && typeof p.id === 'string' && p.exec && p.exec.match instanceof RegExp && typeof p.exec.run === 'function') {
				acc.push(p);
			}
		} catch (_) {}
		return acc;
	}, []);
}

module.exports = { loadLangPlugins };
