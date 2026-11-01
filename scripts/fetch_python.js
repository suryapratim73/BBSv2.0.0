// Downloads a portable CPython runtime for packaging into the app.
//
// Layout contract (common.js getPythonExecutablePath):
//   win32  → python.exe at the target dir root (python.org embeddable zip)
//   unix   → bin/python3 under the target dir (indygreg python-build-standalone install_only)
//
// After extraction, pip is bootstrapped (embeddable/install_only ship without it)
// and py/requirements.txt is installed into the runtime so the installer works
// out of the box. A missing/empty requirements file skips the pip step.
//
// Usage:  node scripts/fetch_python.js [win32] [linux] [darwin]
//   No args → win32 + linux (the CI default). Multiple platforms may be fetched in one run.
// npm hooks: prebuild fetches win32+linux (for `build` -wl); prebuild_win /
// prebuild_linux fetch one each (npm runs them before build_win / build_linux).

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { execSync, spawnSync } = require('child_process');

// Verified working as of 2026-09-18. Arch must match the build targets in
// package.json (nsis x64 / deb x64) and the layout expected by common.js.
const PYTHON_URLS = {
  win32:  'https://www.python.org/ftp/python/3.13.15/python-3.13.15-embed-amd64.zip',
  darwin: 'https://github.com/indygreg/python-build-standalone/releases/download/20260901/cpython-3.13.15+20260901-aarch64-apple-darwin-install_only.tar.gz',
  linux:  'https://github.com/indygreg/python-build-standalone/releases/download/20260901/cpython-3.13.15+20260901-x86_64-unknown-linux-gnu-install_only.tar.gz'
};

// Binary that must exist after extraction, per the common.js layout contract
const REQUIRED_BINARY = {
  win32: 'python.exe',
  darwin: 'bin/python3',
  linux: 'bin/python3'
};

const requested = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
// Runs on the Linux CI where electron-builder invokes it for both targets —
// default to both platforms; never use process.platform (it would always be linux).
const targets = requested.length ? requested : ['win32', 'linux'];

const unknown = targets.filter(t => !PYTHON_URLS[t]);
if (unknown.length) {
  console.error(`Unsupported platform: ${unknown.join(', ')} (supported: ${Object.keys(PYTHON_URLS).join(', ')})`);
  process.exit(1);
}

// axios follows redirects (GitHub release assets 302 to release-assets.githubusercontent.com)
// and rejects non-2xx statuses — both were broken with the old https.get piped download.
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

// Single source of truth for what gets pre-installed into the runtime
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

// Bootstraps pip into a target runtime that ships without it (python.org
// embeddable zip, indygreg install_only): downloads get-pip.py and runs it
// with the target interpreter. get-pip.py is self-contained, so it needs no
// pre-existing pip or ensurepip wheels.
async function bootstrapPip(pythonBinary, getPipPath) {
  try {
    await download('https://bootstrap.pypa.io/get-pip.py', getPipPath);
    const res = spawnSync(pythonBinary, [getPipPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (res.status !== 0) {
      throw new Error(`get-pip.py failed for ${pythonBinary}: ${(res.stderr || res.stdout || '').trim().slice(0, 500)}`);
    }
  } finally {
    if (fs.existsSync(getPipPath)) fs.unlinkSync(getPipPath);
  }
}

// Where a platform's packages must live for the runtime to import them:
// win embeddable → Lib/site-packages under the exe dir; unix → the standard
// versioned lib path under the prefix (site adds these at startup).
function sitePackagesFor(platform, targetDir) {
  return platform === 'win32'
    ? path.join(targetDir, 'Lib', 'site-packages')
    : path.join(targetDir, 'lib', 'python3.13', 'site-packages');
}

// Installs py/requirements.txt into the freshly extracted runtime so the
// shipped installer works out of the box. When the target interpreter cannot
// run on this host (win32 runtime fetched on the Linux CI), falls back to a
// host-pip cross-install pinned to the target platform's wheel tags.
async function installRequirements(platform, targetDir, pythonBinary) {
  const reqFile = readRequirements();
  if (!reqFile) {
    console.log(`[${platform}] py/requirements.txt empty or missing — shipping bare CPython (pip step skipped).`);
    return;
  }

  const sitePackages = sitePackagesFor(platform, targetDir);
  const probe = spawnSync(pythonBinary, ['--version'], { encoding: 'utf8' });
  const runnable = !probe.error && probe.status === 0;

  if (runnable) {
    let pip = spawnSync(pythonBinary, ['-m', 'pip', '--version'], { encoding: 'utf8' });
    if (pip.status !== 0) {
      console.log(`[${platform}] No pip in runtime — bootstrapping via get-pip.py`);
      await bootstrapPip(pythonBinary, path.join(path.dirname(targetDir), 'get-pip.py'));
      pip = spawnSync(pythonBinary, ['-m', 'pip', '--version'], { encoding: 'utf8' });
      if (pip.status !== 0) throw new Error(`pip bootstrap failed for ${pythonBinary}`);
    }
    const res = spawnSync(pythonBinary, ['-m', 'pip', 'install', '--no-warn-script-location', '--target', sitePackages, '-r', reqFile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (res.status !== 0) {
      throw new Error(`pip install failed for ${platform}: ${(res.stderr || res.stdout || '').trim().slice(0, 800)}`);
    }
    console.log(`[${platform}] pip install from py/requirements.txt → ${path.relative(path.join(__dirname, '..'), sitePackages)} complete`);
    return;
  }

  // Cross-host: run the host's pip with the target platform pinned so only
  // matching wheels resolve (pure-python + platform wheels).
  const hostPy = ['python3', 'python'].find(cmd => !spawnSync(cmd, ['--version'], { encoding: 'utf8' }).error);
  if (!hostPy) throw new Error(`Cannot run ${pythonBinary} on this host and no host python found for cross-install`);
  const platformTag = { win32: 'win_amd64', darwin: 'macosx_11_0_arm64' }[platform];
  if (!platformTag) throw new Error(`No cross-install wheel platform mapped for ${platform} — add one`);
  const args = ['-m', 'pip', 'install', '--no-warn-script-location', '--only-binary=:all:', '--platform', platformTag,
    '--implementation', 'cp', '--abi', 'cp313', '--python-version', '3.13', '--target', sitePackages, '-r', reqFile];
  const res = spawnSync(hostPy, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    throw new Error(`cross pip install failed for ${platform}: ${(res.stderr || res.stdout || '').trim().slice(0, 800)}`);
  }
  console.log(`[${platform}] cross pip install (host ${hostPy} → ${platformTag}) complete`);
}

// Extracts the install_only tarball (top-level python/ dir → --strip-components=1).
// GNU tar (Git Bash) treats drive-letter paths like "C:\..." as a remote host, so
// run it with relative paths from python-env/ as cwd. On Windows without symlink
// privileges tar extracts every regular file but fails/skips the link entries
// (bin/python3 → python3.13, lib/*.so, terminfo links); GNU tar exits non-zero,
// bsdtar may exit 0 with warnings — so repair whenever bin/python3 is missing,
// recreating links as file copies (functionally identical on the Linux target).
function extractTarUnix(tmpName, platform) {
  const cwd = path.join(__dirname, '../python-env');
  const cmd = `tar -xzf "${tmpName}" -C "${platform}" --strip-components=1`;
  try {
    execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (err) {
    // regular files are extracted; link entries failed — repair below
  }

  if (fs.existsSync(path.join(cwd, platform, 'bin', 'python3'))) return;

  // tar -t ignores --strip-components, so listing names keep the top-level
  // python/ prefix — strip the first component here to match extraction layout
  const listing = execSync(`tar -tvzf "${tmpName}"`, { cwd, encoding: 'utf8' });
  const links = [];
  for (const line of listing.split('\n')) {
    const arrow = line.indexOf(' -> ');
    if (arrow === -1) continue;
    const member = line.slice(0, arrow).trim().split(/\s+/).pop().replace(/^\.\//, '');
    const stripped = member.includes('/') ? member.slice(member.indexOf('/') + 1) : member;
    if (!stripped) continue;
    links.push({ linkName: stripped, target: line.slice(arrow + 4).trim() });
  }
  for (let pass = 0; pass < 2; pass++) { // second pass resolves chained links
    for (const { linkName, target } of links) {
      const dest = path.join(cwd, platform, linkName);
      if (fs.existsSync(dest)) continue;
      const src = path.resolve(path.dirname(dest), target);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
  }
  console.log(`[${platform}] tar could not create symlinks (no Windows symlink privileges) — recreated them as file copies.`);
}

async function fetchPlatform(platform) {
  const targetDir = path.join(__dirname, '../python-env', platform);
  const binary = path.join(targetDir, REQUIRED_BINARY[platform]);
  const isZip = platform === 'win32';
  const tmpFile = path.join(__dirname, '../python-env', `python-temp-${platform}${isZip ? '.zip' : '.tar.gz'}`);

  console.log(`[${platform}] Downloading Python: ${PYTHON_URLS[platform]}`);
  try {
    fs.mkdirSync(targetDir, { recursive: true }); // ensures python-env/ exists for the temp file
    await download(PYTHON_URLS[platform], tmpFile);
    console.log(`[${platform}] Download complete (${(fs.statSync(tmpFile).size / 1024 / 1024).toFixed(1)} MB). Extracting...`);

    // Fresh extraction every run — a corrupt/partial or version-stale
    // python-env must never ship. rmSync is force:true so a missing dir
    // cannot throw; a real permission error SHOULD fail the build loudly
    // rather than extract over stale files.
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });

    if (isZip) {
      new AdmZip(tmpFile).extractAllTo(targetDir, true);
    } else {
      extractTarUnix(path.basename(tmpFile), platform);
    }

    if (!fs.existsSync(binary))
      throw new Error(`extraction did not produce ${REQUIRED_BINARY[platform]} — refusing to ship a broken runtime`);

    // Windows embed ships site imports disabled; enable them so pip-installed packages load
    for (const pthFile of fs.readdirSync(targetDir).filter(f => f.endsWith('_pth'))) {
      const pthPath = path.join(targetDir, pthFile);
      const content = fs.readFileSync(pthPath, 'utf8').replace('#import site', 'import site');
      fs.writeFileSync(pthPath, content, 'utf8');
    }

    // Pre-install py/requirements.txt so the installer works out of the box
    // (must run after the _pth `import site` fix above so packages can load).
    await installRequirements(platform, targetDir, binary);

    console.log(`[${platform}] Python environment ready at python-env/${platform}`);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

(async () => {
  let failed = false;
  for (const target of targets) {
    try {
      await fetchPlatform(target);
    } catch (err) {
      failed = true;
      console.error(`[${target}] ${err.message}`);
    }
  }
  if (failed) process.exit(1);
})();
