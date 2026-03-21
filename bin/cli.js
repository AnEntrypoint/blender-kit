#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { version } = require('../package.json');
const { registerCoreCommands } = require('../lib/cli-core');
const { registerRuntimeCommands } = require('../lib/cli-runtime');

const program = new Command();
program
  .name('blender-dev')
  .description('Agentic Blender 4.x CLI - Python REPL, scene inspector, HTTP bridge, headless rendering')
  .version(version);

registerCoreCommands(program);
registerRuntimeCommands(program);

program.parse(process.argv);
