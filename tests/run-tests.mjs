/**
 * Runs the test files with the Node.js built-in test runner.
 * No dependency is installed for this: `node --test` is part of Node.js.
 *
 * Usage:  node tests/run-tests.mjs      (or: npm test)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// No path argument: the test runner discovers every *.test.mjs file from the repository root.
const result = spawnSync(process.execPath, ['--test'], {
  stdio: 'inherit',
  cwd: repositoryRoot
});

process.exit(result.status ?? 1);
