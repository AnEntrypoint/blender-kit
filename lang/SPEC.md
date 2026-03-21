# lang/ Plugin Specification

## Plugin Module Shape

```js
module.exports = {
  id: 'blender',
  exec: {
    match: /^exec:blender/,
    run(code, cwd) { /* returns Promise<string> */ }
  },
  lsp: {                                           // optional
    check(code, cwd) { /* returns Promise<Diagnostic[]> */ }
  },
  context: 'string or () => string'               // optional
};
```

## Types

```ts
type Diagnostic = {
  line: number;
  col: number;
  message: string;
  severity: 'error' | 'warning';
};
```

## Plugin Loading

- gm-cc scans `<projectDir>/lang/*.js` at hook time — no project-level hook setup needed
- Validates shape `{ id, exec: { match, run } }` — invalid plugins are silently skipped
- `lang/loader.js` is a convenience export for testing; hooks inline their own loader

## exec: Dispatch (pre-tool-use hook — gm-cc managed)

Intercepts `exec:<id>\n<code>` when `<id>` is not a built-in lang.

1. Find first plugin where `plugin.exec.match.test(command)`
2. Call `plugin.exec.run(code, cwd)` in a child process (30s timeout)
3. Return output as `exec:<id> output:\n\n<result>`
4. If no plugin matches, fall through to built-in exec: dispatch

## LSP Context (prompt-submit hook — gm-cc managed)

1. Load all plugins from `<projectDir>/lang/`
2. For each plugin with `lsp` + `extensions`: scan top 3 most-recently-modified matching files
3. Call `plugin.lsp.check(fileContent, dir)` synchronously — async not supported here
4. Inject diagnostics as `<file>:<line>:<col>: <severity>: <message>` into `additionalContext`

## context Injection (session-start + prompt-submit hooks — gm-cc managed)

For each plugin with `context`:
- String: injected directly into `additionalContext`
- Function: called, result injected (truncated to 2000 chars)
- Failures are silent

## Constraints

- `exec.run` must resolve within 10s or be killed via `AbortController`
- Multiple plugins may match — first match wins
- Plugins must be CommonJS (`module.exports`)
- No plugin may mutate global state or spawn persistent processes
