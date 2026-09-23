import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * 2026-09-23 audit, item 5. 118 confidential files — client proposals, internal
 * planning documents, draft analyses, screen recordings, .env.production — sat
 * untracked but NOT ignored in this PUBLIC repository, so one `git add -A` would
 * have published them. Commit 4ce2585 shows it had happened before.
 *
 * THE RULES ARE TESTED IN ISOLATION. `git check-ignore` also reads
 * .git/info/exclude and the user's global excludes, and on the owner's machine
 * info/exclude carries these same patterns plus the name-revealing ones no
 * committed file may hold. Asked inside the real repository this test would pass
 * locally against an empty .gitignore. So the committed .gitignore is copied into a
 * fresh repository that contains nothing else. The git calls also run with every
 * inherited GIT_* variable stripped and with git init given an empty template, so
 * neither an inherited GIT_DIR nor a global init.templateDir can point them at, or
 * seed them from, the real repository.
 */
const repo = mkdtempSync(join(tmpdir(), 'gitignore-check-'));
after(() => rmSync(repo, { recursive: true, force: true }));

// Every GIT_* variable is dropped: git exports GIT_DIR (and friends) to hooks, `rebase -x`
// and `bisect run`, and an inherited GIT_DIR points `git init` and `check-ignore` at the
// REAL repository, which both defeats the isolation and rewrites its shared config.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);
execFileSync('git', ['init', '-q', '--template=', repo], { env });
copyFileSync('.gitignore', join(repo, '.gitignore'));

const ignored = (path) => {
  try {
    execFileSync('git', ['-C', repo, '-c', 'core.excludesFile=/dev/null',
      'check-ignore', '--no-index', '-q', '--', path], { stdio: 'ignore', env });
    return true;   // exit 0: ignored
  } catch (error) {
    if (error.status === 1) return false;  // exit 1: not ignored
    throw error;                            // anything else is a broken check, not an answer
  }
};

const MUST_IGNORE = [
  '.env.production',
  '.env.staging',
  'notes.docx',
  'docs/research/some-proposal.docx',
  'docs/research/client-review.pdf',
  'docs/Ideas_and_Prototypes/anything.pdf',
  'docs/Ideas_and_Prototypes/sub/folder/notes.md',
  'docs/a-recording.mov',
  'docs/deep/nested/clip.mp4',
  'tmp/scratch.txt',
  'preview-obos/index.html',
  'attic/heat-fx/shader.ts',
  'docs/audits/some-audit/README.md',
];

const MUST_STAY_VISIBLE = [
  '.env.example',
  'docs/research/2026-09-23-a-research-note.md',
  'docs/briefings/2026-08-09-twin-credibility-briefing.pdf',
  // attic/ holds shelved code main tracks on purpose; only the one parked pass is ignored
  'attic/hero-v1/README.md',
];

test('confidential material cannot be staged by a blanket git add', () => {
  for (const path of MUST_IGNORE) assert.ok(ignored(path), `${path} is not ignored`);
});

test('the ignore rules do not swallow what the repository publishes on purpose', () => {
  for (const path of MUST_STAY_VISIBLE) assert.ok(!ignored(path), `${path} is ignored but must not be`);
});
