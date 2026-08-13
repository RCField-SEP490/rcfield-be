#!/usr/bin/env node
/**
 * Soi chỗ "đứt" giữa frontend và backend.
 *
 * Đối chiếu MỌI lệnh gọi API trong mã frontend với MỌI route đã đăng ký ở
 * backend, rồi chỉ ra hai loại lệch:
 *
 *   ĐỨT   — frontend gọi một endpoint backend KHÔNG có. Chạy lên là 404, và
 *           thường không ai biết cho tới khi người dùng bấm đúng nút đó.
 *   THỪA  — backend có endpoint mà không frontend nào gọi. Không gây lỗi, nhưng
 *           là bề mặt tấn công và mã chết cần rà.
 *
 * Đây chính là loại lỗi đã xảy ra thật: `/v1/explore/featured-popups` tồn tại ở
 * nhánh phát triển nhưng chưa lên production, nên trang khám phá gọi vào hư không.
 *
 * Dùng:
 *   node scripts/check-api-contract.js <thư-mục-frontend> [--json]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const feRoot = process.argv[2];
const asJson = process.argv.includes('--json');
if (!feRoot || !fs.existsSync(feRoot)) {
  console.error('Dùng: node scripts/check-api-contract.js <thư-mục-frontend> [--json]');
  process.exit(1);
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'build', 'coverage'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Chuẩn hoá đường dẫn để so được giữa hai bên.
 * Tham số động ở FE là `${...}`, ở BE là `:name` — đưa cả hai về `{}`.
 */
function normalize(url) {
  return (
    url
      .replace(/^\/v1/, '')
      .replace(/\$\{[^}]*\}/g, '{}')
      .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}')
      .replace(/\?.*$/, '')
      .replace(/\/+$/, '') || '/'
  );
}

// ── Thu thập lệnh gọi ở frontend ─────────────────────────────────────────────
const feCalls = new Map(); // "METHOD path" -> [file:line]
for (const file of walk(path.join(feRoot, 'src'))) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // api.get<T>("/v1/...") | api.post(`/v1/...`)
    const re = new RegExp(`\\bapi\\.(${METHODS.join('|')})\\s*(?:<[^>]*>)?\\s*\\(\\s*[\`"']([^\`"']+)`, 'g');
    let m;
    while ((m = re.exec(line))) {
      const key = `${m[1].toUpperCase()} ${normalize(m[2])}`;
      const where = `${path.relative(feRoot, file)}:${i + 1}`;
      if (!feCalls.has(key)) feCalls.set(key, []);
      feCalls.get(key).push(where);
    }
  });
}

// ── Thu thập route ở backend ─────────────────────────────────────────────────
const beRoutesDir = path.join(__dirname, '..', 'src', 'routes');
const indexSrc = fs.readFileSync(path.join(beRoutesDir, 'index.ts'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.ts'), 'utf8');

/** Ánh xạ biến router → tệp khai báo, để biết prefix nào gắn với tệp nào. */
const importMap = new Map();
for (const src of [indexSrc, appSrc]) {
  const re = /import\s*\{?\s*([\w\s,]+?)\s*\}?\s*from\s*['"]\.\/(?:routes\/)?([\w.\-]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const name of m[1].split(',').map((x) => x.trim())) importMap.set(name, m[2]);
  }
}

/** prefix → tệp router, gom cả mount trong index.ts lẫn app.ts */
const mounts = [];
for (const [src, base] of [
  [indexSrc, ''],
  [appSrc, ''],
]) {
  const re = /\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
  let m;
  while ((m = re.exec(src))) {
    let prefix = m[1].replace(/^\/api\/v1/, '').replace(/^\/v1/, '');
    mounts.push({ prefix: base + prefix, varName: m[2] });
  }
}

const beRoutes = new Map(); // "METHOD path" -> tệp
function collectFromRouter(file, prefix, seen = new Set()) {
  const full = path.join(beRoutesDir, `${file}.ts`);
  if (!fs.existsSync(full) || seen.has(full)) return;
  seen.add(full);
  const src = fs.readFileSync(full, 'utf8');

  const re = new RegExp(`\\.(${METHODS.join('|')})\\s*\\(\\s*['"]([^'"]*)['"]`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const p = normalize((prefix + m[2]).replace(/\/+/g, '/'));
    beRoutes.set(`${m[1].toUpperCase()} ${p}`, `${file}.ts`);
  }

  // Router lồng, ví dụ trong cafe.routes.ts:
  //   import { menuRouter } from './menu.routes'
  //   cafeRouter.use('/:cafeId/menu', menuRouter)
  //
  // Import kiểu này khai NGAY TRONG tệp router con, không phải ở index.ts, nên
  // phải đọc bảng ánh xạ của chính tệp đang duyệt. Bỏ qua bước này thì mọi
  // endpoint lồng đều bị báo "đứt" oan.
  const localImports = new Map();
  {
    const ri = /import\s*\{?\s*([\w\s,]+?)\s*\}?\s*from\s*['"]\.\/([\w.\-]+)['"]/g;
    let mi;
    while ((mi = ri.exec(src))) {
      for (const name of mi[1].split(',').map((x) => x.trim())) localImports.set(name, mi[2]);
    }
  }

  const nested = /\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
  while ((m = nested.exec(src))) {
    const childFile = localImports.get(m[2]) ?? importMap.get(m[2]);
    if (childFile) collectFromRouter(childFile, `${prefix}${m[1]}`, seen);
  }
}

for (const { prefix, varName } of mounts) {
  const file = importMap.get(varName);
  if (file) collectFromRouter(file, prefix);
}
// route khai trực tiếp trong index.ts (ví dụ /track-types)
{
  const re = new RegExp(`router\\.(${METHODS.join('|')})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
  let m;
  while ((m = re.exec(indexSrc))) {
    beRoutes.set(`${m[1].toUpperCase()} ${normalize(m[2])}`, 'index.ts');
  }
}

// ── Đối chiếu ────────────────────────────────────────────────────────────────
const broken = [];
for (const [call, where] of feCalls) {
  if (!beRoutes.has(call)) broken.push({ call, where });
}
const unused = [...beRoutes.keys()].filter((r) => !feCalls.has(r)).sort();

if (asJson) {
  console.log(JSON.stringify({ broken, unused, feCalls: feCalls.size, beRoutes: beRoutes.size }, null, 2));
} else {
  console.log(`Frontend gọi ${feCalls.size} endpoint · Backend đăng ký ${beRoutes.size} route\n`);
  if (broken.length === 0) {
    console.log('✅ Không có endpoint nào bị đứt.');
  } else {
    console.log(`🔴 ${broken.length} endpoint ĐỨT — frontend gọi nhưng backend không có:\n`);
    for (const b of broken) {
      console.log(`  ${b.call}`);
      for (const w of b.where.slice(0, 3)) console.log(`      ${w}`);
    }
  }
  console.log(`\n⚪ ${unused.length} route backend không frontend nào gọi (tham khảo, không phải lỗi).`);
}

process.exitCode = broken.length > 0 ? 1 : 0;
