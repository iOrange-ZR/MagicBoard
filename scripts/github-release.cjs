/**
 * 使用 GitHub API 创建 Release 并上传构建产物
 * 需要环境变量: GITHUB_TOKEN 或 GH_TOKEN (需 repo 权限)
 * 使用: node scripts/github-release.cjs [version]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(PROJECT_ROOT, 'release');
const PACKAGE_JSON = path.join(PROJECT_ROOT, 'package.json');

const OWNER = 'y501737321';
const REPO = 'MagicBoard';

function getVersion() {
  const v = process.argv[2];
  if (v) return v.startsWith('v') ? v : `v${v}`;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));
  return `v${pkg.version}`;
}

function getProductName() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));
  return (pkg.build && pkg.build.productName) ? pkg.build.productName : '天津美术学院AIGC Tools';
}

function getToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (ch) => { data += ch; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.message || data || `HTTP ${res.statusCode}`));
        } catch (e) {
          reject(new Error(data || e.message));
        }
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) req.write(body);
      else req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function createRelease(token, tag, name, body) {
  const opts = {
    hostname: 'api.github.com',
    path: `/repos/${OWNER}/${REPO}/releases`,
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'MagicBoard-Release',
      'Content-Type': 'application/json'
    }
  };
  return request(opts, { tag_name: tag, name, body: body || '' });
}

async function uploadAsset(token, uploadUrl, filePath) {
  const name = path.basename(filePath);
  const url = new URL(uploadUrl);
  const fileSize = fs.statSync(filePath).size;
  const body = fs.readFileSync(filePath);

  const opts = {
    hostname: url.hostname,
    path: `${url.pathname}?name=${encodeURIComponent(name)}`,
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'MagicBoard-Release',
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize
    }
  };
  return request(opts, body); // body 是 Buffer，request 内会直接 write
}

async function main() {
  const token = getToken();
  if (!token) {
    console.error('请设置环境变量 GITHUB_TOKEN 或 GH_TOKEN（需 repo 权限）');
    console.error('或在浏览器中手动创建: https://github.com/y501737321/MagicBoard/releases/new');
    process.exit(1);
  }

  const version = getVersion();
  const productName = getProductName();
  const tag = version;

  const assets = [
    `latest.yml`,
    `${productName} Setup ${version.replace('v', '')}.exe`,
    `${productName} Setup ${version.replace('v', '')}.exe.blockmap`,
    `${productName} ${version.replace('v', '')}.exe`
  ].filter((name) => {
    const p = path.join(RELEASE_DIR, name);
    return fs.existsSync(p) && fs.statSync(p).isFile();
  });

  if (assets.length === 0) {
    console.error('release 目录下未找到当前版本的构建文件，请先执行: npm run package');
    process.exit(1);
  }

  console.log('创建 Release:', tag);
  const release = await createRelease(token, tag, `Release ${tag}`, `天津美术学院 AIGC Tools ${tag}`);
  const uploadUrl = release.upload_url.replace(/\{.*\}/, '');

  console.log('上传资源:', assets.length, '个文件');
  for (const name of assets) {
    const filePath = path.join(RELEASE_DIR, name);
    process.stdout.write('  ' + name + ' ... ');
    await uploadAsset(token, uploadUrl, filePath);
    console.log('OK');
  }

  console.log('\n发布完成:', release.html_url);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
