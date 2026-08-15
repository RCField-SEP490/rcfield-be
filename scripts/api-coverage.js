#!/usr/bin/env node
'use strict';
/**
 * Đo độ phủ kiểm thử tích hợp trên từng endpoint.
 *
 * Trả lời đúng một câu hỏi: trong toàn bộ API của hệ thống, bao nhiêu endpoint
 * ĐÃ ĐƯỢC GỌI THẬT trong bộ kiểm thử chạy trên cơ sở dữ liệu thật.
 *
 * Đây không phải độ phủ dòng lệnh. Một tệp service có thể phủ 90% dòng mà vẫn
 * chưa endpoint nào của nó được gọi qua HTTP — nghĩa là chưa ai kiểm middleware
 * xác thực, phân quyền, và bước kiểm dữ liệu vào. Con số ở đây đo đúng thứ hội
 * đồng và người dùng nhìn thấy: cái endpoint đó có ai bấm thử chưa.
 *
 * Cách dùng:
 *   node scripts/api-coverage.js            # in ra màn hình
 *   node scripts/api-coverage.js --md FILE  # xuất Markdown cho CI
 *   node scripts/api-coverage.js --json     # xuất JSON
 *   node scripts/api-coverage.js --min 60   # thoát mã 1 nếu phủ dưới 60%
 */
const fs = require('fs');
const path = require('path');
const { METHODS, normalize, collectBackendRoutes, domainOf } = require('./lib/backend-routes');

const TESTS_DIR = path.join(__dirname, '..', 'src', '__tests__');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * Tìm mọi lời gọi HTTP trong bộ kiểm thử.
 *
 * Bắt cả hai dạng viết:
 *   request(app).get('/api/v1/bookings')
 *   .post(`/api/v1/bookings/${id}/checkout`)
 *
 * Đường dẫn trong test mang uuid thật, phải quy về `{}` mới so được với route
 * khai bằng `:id`.
 */
function collectTestedRoutes() {
  const hits = new Map(); // "METHOD /path" → Set(tệp test)
  const re = new RegExp(`\\.(${METHODS.join('|')})\\s*\\(\\s*[\`'"]([^\`'"]+)[\`'"]`, 'g');
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  for (const file of walk(TESTS_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(src))) {
      const raw = m[2];
      if (!raw.startsWith('/')) continue; // bỏ qua .get('key') của Map, header…
      const key = `${m[1].toUpperCase()} ${normalize(raw.replace(UUID, '{}'))}`;
      if (!hits.has(key)) hits.set(key, new Set());
      hits.get(key).add(path.basename(file));
    }
  }
  return hits;
}

/**
 * Bề mặt không phải API, loại khỏi mẫu số.
 *
 * `/dev-tools/*` là trang công cụ nội bộ trả về HTML/CSS/JS, tắt hẳn ở
 * production. Đếm nó vào độ phủ API là làm sai con số theo cả hai hướng: mẫu số
 * phình lên vì thứ không ai gọi bằng máy, mà kiểm thử cho nó cũng vô nghĩa.
 */
const NOT_API = [/^\/dev-tools\b/];

const routes = new Map(
  [...collectBackendRoutes()].filter(
    ([key]) => !NOT_API.some((re) => re.test(key.split(' ')[1] ?? '')),
  ),
);
const tested = collectTestedRoutes();

const rows = [...routes.keys()].sort().map((key) => ({
  key,
  file: routes.get(key),
  domain: domainOf(key),
  covered: tested.has(key),
  by: tested.has(key) ? [...tested.get(key)] : [],
}));

const total = rows.length;
const covered = rows.filter((r) => r.covered).length;
const pct = total ? Math.round((covered / total) * 100) : 0;

// ── gom theo miền ────────────────────────────────────────────────────────────
const byDomain = new Map();
for (const r of rows) {
  if (!byDomain.has(r.domain)) byDomain.set(r.domain, { total: 0, covered: 0 });
  const d = byDomain.get(r.domain);
  d.total += 1;
  if (r.covered) d.covered += 1;
}
const domains = [...byDomain.entries()]
  .map(([name, v]) => ({ name, ...v, pct: Math.round((v.covered / v.total) * 100) }))
  .sort((a, b) => b.total - a.total);

// ── xuất ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mdIndex = args.indexOf('--md');
const minIndex = args.indexOf('--min');

function bar(p) {
  const filled = Math.round(p / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

if (args.includes('--json')) {
  process.stdout.write(
    JSON.stringify({ total, covered, pct, domains, routes: rows }, null, 2) + '\n',
  );
} else if (mdIndex >= 0) {
  const lines = [];
  lines.push('## Độ phủ kiểm thử API');
  lines.push('');
  lines.push(
    `**${covered}/${total} endpoint** đã được gọi thật trong kiểm thử tích hợp — **${pct}%**`,
  );
  lines.push('');
  lines.push('| Miền | Đã phủ | Tổng | Tỷ lệ |');
  lines.push('|---|---:|---:|---|');
  for (const d of domains) {
    lines.push(`| \`${d.name}\` | ${d.covered} | ${d.total} | ${bar(d.pct)} ${d.pct}% |`);
  }
  lines.push('');
  const uncovered = rows.filter((r) => !r.covered);
  if (uncovered.length) {
    lines.push(`<details><summary>${uncovered.length} endpoint chưa có kiểm thử</summary>`);
    lines.push('');
    lines.push('```');
    for (const r of uncovered) lines.push(`${r.key.padEnd(52)} ${r.file}`);
    lines.push('```');
    lines.push('</details>');
  }
  const out = lines.join('\n') + '\n';
  const target = args[mdIndex + 1];
  if (target) fs.writeFileSync(target, out);
  else process.stdout.write(out);
} else {
  console.log('');
  console.log(`  Độ phủ kiểm thử API:  ${covered}/${total}  (${pct}%)  ${bar(pct)}`);
  console.log('');
  for (const d of domains) {
    console.log(
      `    ${d.name.padEnd(24)} ${String(d.covered).padStart(3)}/${String(d.total).padEnd(3)}  ${bar(d.pct)} ${d.pct}%`,
    );
  }
  console.log('');
}

if (minIndex >= 0) {
  const min = Number(args[minIndex + 1]);
  if (Number.isFinite(min) && pct < min) {
    console.error(`\n  Độ phủ ${pct}% thấp hơn ngưỡng ${min}%.\n`);
    process.exit(1);
  }
}
