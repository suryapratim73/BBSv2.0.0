// Downloads a portable CPython runtime for packaging into the app.
//
// Layout contract (common.js getPythonExecutablePath):
//   win32  → python.exe at the target dir root (python.org embeddable zip)
//   unix   → bin/python3 under the target dir (indygreg python-build-standalone install_only)
//
// Usage:  node scripts/fetch_python.js [win32] [linux] [darwin]
//   No args → win32 + linux (the CI default). Multiple platforms may be fetched in one run.
// npm hooks: prebuild fetches win32+linux (for `build` -wl); prebuild_win /
// prebuild_linux fetch one each (npm runs them before build_win / build_linux).

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { execSync } = require('child_process');

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
