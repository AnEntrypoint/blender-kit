'use strict';
const { BRIDGE_PY_HEAD } = require('./bridge-core-py');
const { BRIDGE_PY_HANDLER } = require('./bridge-handler-py');
const BLENDER_BRIDGE_PY = BRIDGE_PY_HEAD + BRIDGE_PY_HANDLER;
module.exports = { BLENDER_BRIDGE_PY };
