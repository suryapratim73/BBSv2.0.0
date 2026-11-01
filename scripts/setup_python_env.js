// Dev-only helper: (re)install py/requirements.txt into the portable CPython
// runtime at python-env/<host platform>/ so py/main.py runs cleanly when
// pythonHandler.js spawns it in DEV (layout per common.js getPythonExecutablePath).
//
// scripts/fetch_python.js (npm prebuild hooks) downloads the runtime AND runs
// these pip steps; it stays the source of truth for the shipped installer.
// This script exists for the dev machine between fetches — after a fresh
// clone, after requirements change, or when the runtime lost its packages
// (e.g. extracted without the pip step) — without re-downloading the runtime.
// Never shipped: no package.json build hook runs it and the app only walks
// the DEV python-env path, never the packaged one.
//
// Usage:
//   node scripts/setup_python_env.js              # install requirements into the local runtime
//   node scripts/setup_python_env.js --bootstrap  # fetch the runtime first when it is missing

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync, spawnSync } = require('child_process');

// Layout contract, mirrored from fetch_python.js / common.js — win embeddable
// python.exe sits at the target dir root, unix install_only at bin/python3.
const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const targetDir = path.join(__dirname, '..', 'python-env', platform);
const pythonBinary = platform === 'win32'
  ? path.join(targetDir, 'python.exe')
  : path.join(targetDir, 'bin', 'python3');
const sitePackages = platform === 'win32'
  ? path.join(targetDir, 'Lib', 'site-packages')
  : path.join(targetDir, 'lib', 'python3.13', 'site-packages');

// Single source of truth for what gets installed into the runtime
// (one pip requirement per line; comments/blank lines allowed).
const REQUIREMENTS = path.join(__dirname, '..', 'py', 'requirements.txt');

function readRequirements() {
  if (!fs.existsSync(REQUIREMENTS)) return null;
  // An all-comment file counts as "no packages" — don't let headers trigger
  // a pip run (and never pass the raw file to the skip check).
  const effective = fs.readFileSync(REQUIREMENTS, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  return effective.length ? REQUIREMENTS : null;
}

// axios follows redirects and rejects non-2xx statuses — same as fetch_python.js.
async function download(url, dest) {
  const response = await axios.get(url, { responseType: 'stream', timeout: 10 * 60 * 1000 });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

// Bootstraps pip into a runtime that ships without it (python.org embeddable
// zip, indygreg install_only): downloads get-pip.py and runs it with the
// target interpreter. get-pip.py is self-contained, so it needs no
// pre-existing pip or ensurepip wheels.
async function bootstrapPip(getPipPath) {
  try {
    await download('https://bootstrap.pypa.io/get-pip.py', getPipPath);
    const res = spawnSync(pythonBinary, [getPipPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (res.status !== 0) {
      throw new Error(`get-pip.py failed: ${(res.stderr || res.stdout || '').trim().slice(0, 500)}`);
    }
  } finally {
    if (fs.existsSync(getPipPath)) fs.unlinkSync(getPipPath);
  }
}

// The win embed ships site imports disabled; pip-installed packages only load
// once `import site` is uncommented. fetch_python.js does this at extract
// time — re-apply here so a manually extracted runtime still works.
function ensureSiteEnabled() {
  if (platform !== 'win32') return;
  const pthFiles = fs.existsSync(targetDir)
    ? fs.readdirSync(targetDir).filter(f => f.endsWith('_pth'))
    : [];
  if (!pthFiles.length) {
    console.log('[win32] No _pth file found — the runtime may not be extracted yet.');
    return;
  }
  for (const pthFile of pthFiles) {
    const pthPath = path.join(targetDir, pthFile);
    const content = fs.readFileSync(pthPath, 'utf8');
    if (!content.includes('import site')) continue;
    fs.writeFileSync(pthPath, content.replace('#import site', 'import site'), 'utf8');
  }
}

async function main() {
  const bootstrap = process.argv.includes('--bootstrap');
  if (!fs.existsSync(pythonBinary)) {
    if (bootstrap) {
      console.log(`[${platform}] Runtime missing — running scripts/fetch_python.js ${platform} (downloads CPython + installs requirements).`);
      execSync(`node "${path.join(__dirname, 'fetch_python.js')}" ${platform}`, { stdio: 'inherit' });
      return; // fetch_python.js already installed the requirements
    }
    console.error(`[${platform}] No python runtime at ${path.relative(path.join(__dirname, '..'), pythonBinary)}`);
    console.error(`        Run "node scripts/setup_python_env.js --bootstrap" or "node scripts/fetch_python.js ${platform}" first.`);
    process.exit(1);
  }

  ensureSiteEnabled();

  const reqFile = readRequirements();
  if (!reqFile) {
    console.log(`[${platform}] py/requirements.txt empty or missing — nothing to install (runtime left as-is).`);
    return;
  }

  // The host runs its own runtime here (unlike fetch_python.js cross-installs),
  // so the interpreter must be runnable — fail loudly rather than guess.
  const probe = spawnSync(pythonBinary, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error(`[${platform}] ${pythonBinary} is not runnable on this host: ${(probe.error && probe.error.message) || probe.stderr}`);
    process.exit(1);
  }

  let pip = spawnSync(pythonBinary, ['-m', 'pip', '--version'], { encoding: 'utf8' });
  if (pip.status !== 0) {
    console.log(`[${platform}] No pip in runtime — bootstrapping via get-pip.py`);
    await bootstrapPip(path.join(__dirname, '..', 'python-env', 'get-pip.py'));
    pip = spawnSync(pythonBinary, ['-m', 'pip', '--version'], { encoding: 'utf8' });
    if (pip.status !== 0) throw new Error(`pip bootstrap failed for ${pythonBinary}`);
  }

  console.log(`[${platform}] pip install from py/requirements.txt → ${path.relative(path.join(__dirname, '..'), sitePackages)}`);
  const res = spawnSync(pythonBinary, ['-m', 'pip', 'install', '--no-warn-script-location', '--target', sitePackages, '-r', reqFile],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    console.error(`[${platform}] pip install failed: ${(res.stderr || res.stdout || '').trim().slice(0, 800)}`);
    process.exit(1);
  }
  console.log(`[${platform}] Done — ${pythonBinary} can now import the installed packages (pythonHandler.js ready).`);
}

main().catch(err => {
  console.error(`[${platform}] ${err.message}`);
  process.exit(1);
});
