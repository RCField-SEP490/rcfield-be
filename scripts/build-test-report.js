#!/usr/bin/env node
/**
 * Dựng báo cáo kiểm thử từ kết quả Jest.
 *
 * Đọc `--json` gốc của Jest nên KHÔNG cần thêm phụ thuộc nào (`jest-junit` và
 * họ hàng đều không cần thiết cho việc này).
 *
 * Sinh ra ba tệp, mỗi tệp phục vụ một người đọc khác nhau:
 *   junit.xml        — định dạng chuẩn cho công cụ CI/QA đọc máy
 *   test-report.html — bản trình bày để đính kèm báo cáo đồ án
 *   test-report.md   — tóm tắt hiện thẳng trên trang tổng kết của GitHub Actions
 *
 * Dùng:
 *   node scripts/build-test-report.js <jest.json> [coverage-summary.json] [thư-mục-ra]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const [, , resultsPath, coveragePath, outDirArg] = process.argv;
if (!resultsPath) {
  console.error('Thiếu đường dẫn tới tệp JSON kết quả Jest.');
  process.exit(1);
}

const outDir = outDirArg || 'test-report';
fs.mkdirSync(outDir, { recursive: true });

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const coverage =
  coveragePath && fs.existsSync(coveragePath)
    ? JSON.parse(fs.readFileSync(coveragePath, 'utf8')).total
    : null;

const escapeXml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch],
  );
const escapeHtml = (value) =>
  String(value).replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch]);

/** Rút gọn đường dẫn tuyệt đối thành đường dẫn trong kho cho dễ đọc. */
function shortPath(filePath) {
  const marker = `${path.sep}src${path.sep}`;
  const at = filePath.lastIndexOf(marker);
  return at === -1 ? path.basename(filePath) : filePath.slice(at + 1);
}

const suites = results.testResults.map((suite) => {
  const cases = suite.assertionResults ?? suite.testResults ?? [];
  return {
    name: shortPath(suite.name ?? suite.testFilePath ?? 'unknown'),
    durationMs: Math.max(0, (suite.endTime ?? 0) - (suite.startTime ?? 0)),
    cases: cases.map((c) => ({
      title: [...(c.ancestorTitles ?? []), c.title].filter(Boolean).join(' › '),
      status: c.status,
      durationMs: c.duration ?? 0,
      failure: (c.failureMessages ?? []).join('\n'),
    })),
  };
});

const totals = {
  suites: results.numTotalTestSuites,
  suitesFailed: results.numFailedTestSuites,
  tests: results.numTotalTests,
  passed: results.numPassedTests,
  failed: results.numFailedTests,
  skipped: results.numPendingTests,
  todo: results.numTodoTests ?? 0,
  durationMs: suites.reduce((sum, s) => sum + s.durationMs, 0),
};
const passRate = totals.tests ? ((totals.passed / totals.tests) * 100).toFixed(2) : '0.00';
const generatedAt = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── junit.xml ────────────────────────────────────────────────────────────────
const junit = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<testsuites name="RCField Backend" tests="${totals.tests}" failures="${totals.failed}" skipped="${totals.skipped}" time="${(totals.durationMs / 1000).toFixed(3)}">`,
  ...suites.map((suite) => {
    const failed = suite.cases.filter((c) => c.status === 'failed').length;
    const skipped = suite.cases.filter(
      (c) => c.status !== 'failed' && c.status !== 'passed',
    ).length;
    return [
      `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.cases.length}" failures="${failed}" skipped="${skipped}" time="${(suite.durationMs / 1000).toFixed(3)}">`,
      ...suite.cases.map((c) => {
        const open = `    <testcase classname="${escapeXml(suite.name)}" name="${escapeXml(c.title)}" time="${(c.durationMs / 1000).toFixed(3)}"`;
        if (c.status === 'failed') {
          return `${open}>\n      <failure>${escapeXml(c.failure)}</failure>\n    </testcase>`;
        }
        if (c.status !== 'passed') return `${open}>\n      <skipped/>\n    </testcase>`;
        return `${open}/>`;
      }),
      '  </testsuite>',
    ].join('\n');
  }),
  '</testsuites>',
].join('\n');
fs.writeFileSync(path.join(outDir, 'junit.xml'), junit);

// ── test-report.md ───────────────────────────────────────────────────────────
const covRow = (label, m) => (m ? `| ${label} | ${m.pct}% | ${m.covered}/${m.total} |` : '');
const md = [
  '# Báo cáo kiểm thử — RCField Backend',
  '',
  `**Thời điểm chạy:** ${generatedAt} (giờ Việt Nam)`,
  '',
  '## Tổng hợp',
  '',
  '| Chỉ số | Giá trị |',
  '|---|---|',
  `| Bộ kiểm thử | ${totals.suites} (${totals.suitesFailed} lỗi) |`,
  `| Tổng số ca | ${totals.tests} |`,
  `| Đạt | **${totals.passed}** |`,
  `| Lỗi | ${totals.failed} |`,
  `| Bỏ qua | ${totals.skipped} |`,
  `| Chưa viết (todo) | ${totals.todo} |`,
  `| Tỷ lệ đạt | **${passRate}%** |`,
  `| Thời gian | ${(totals.durationMs / 1000).toFixed(1)} giây |`,
  '',
  ...(coverage
    ? [
        '## Độ phủ mã nguồn',
        '',
        '| Loại | Tỷ lệ | Đã phủ / Tổng |',
        '|---|---|---|',
        covRow('Câu lệnh (statements)', coverage.statements),
        covRow('Nhánh (branches)', coverage.branches),
        covRow('Hàm (functions)', coverage.functions),
        covRow('Dòng (lines)', coverage.lines),
        '',
      ]
    : []),
  ...(totals.failed > 0
    ? [
        '## Ca lỗi',
        '',
        ...suites.flatMap((s) =>
          s.cases.filter((c) => c.status === 'failed').map((c) => `- \`${s.name}\` — ${c.title}`),
        ),
        '',
      ]
    : ['> Không có ca lỗi.', '']),
].join('\n');
fs.writeFileSync(path.join(outDir, 'test-report.md'), md);

// ── test-report.html ─────────────────────────────────────────────────────────
const ok = totals.failed === 0;
const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<title>Báo cáo kiểm thử — RCField Backend</title>
<style>
 body{font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1b1b;margin:0;padding:32px;background:#faf9f8}
 .wrap{max-width:960px;margin:0 auto}
 h1{font-size:24px;margin:0 0 4px} .sub{color:#747878;margin-bottom:24px}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
 .card{background:#fff;border:1px solid #e5e2e1;border-radius:12px;padding:14px}
 .card .k{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#747878}
 .card .v{font-size:24px;font-weight:800;margin-top:4px}
 .ok{color:#047857} .bad{color:#b91c1c}
 table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e2e1;border-radius:12px;overflow:hidden}
 th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #f0eeed;font-size:13px}
 th{background:#f6f3f2;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5d5f5f}
 tr:last-child td{border-bottom:none}
 td.num{text-align:right;font-variant-numeric:tabular-nums}
 h2{font-size:16px;margin:28px 0 10px}
 .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
 .pill.ok{background:#d1fae5;color:#047857} .pill.bad{background:#fee2e2;color:#b91c1c}
</style></head><body><div class="wrap">
<h1>Báo cáo kiểm thử — RCField Backend</h1>
<p class="sub">Chạy lúc ${escapeHtml(generatedAt)} (giờ Việt Nam)</p>
<div class="cards">
 <div class="card"><div class="k">Tổng số ca</div><div class="v">${totals.tests}</div></div>
 <div class="card"><div class="k">Đạt</div><div class="v ok">${totals.passed}</div></div>
 <div class="card"><div class="k">Lỗi</div><div class="v ${ok ? 'ok' : 'bad'}">${totals.failed}</div></div>
 <div class="card"><div class="k">Tỷ lệ đạt</div><div class="v ${ok ? 'ok' : 'bad'}">${passRate}%</div></div>
 <div class="card"><div class="k">Bộ kiểm thử</div><div class="v">${totals.suites}</div></div>
 <div class="card"><div class="k">Thời gian</div><div class="v">${(totals.durationMs / 1000).toFixed(0)}s</div></div>
</div>
${
  coverage
    ? `<h2>Độ phủ mã nguồn</h2><table><tr><th>Loại</th><th>Tỷ lệ</th><th>Đã phủ / Tổng</th></tr>
${['statements', 'branches', 'functions', 'lines']
  .map((k) =>
    coverage[k]
      ? `<tr><td>${{ statements: 'Câu lệnh', branches: 'Nhánh', functions: 'Hàm', lines: 'Dòng' }[k]}</td><td class="num">${coverage[k].pct}%</td><td class="num">${coverage[k].covered}/${coverage[k].total}</td></tr>`
      : '',
  )
  .join('\n')}</table>`
    : ''
}
<h2>Chi tiết theo bộ kiểm thử</h2>
<table><tr><th>Bộ kiểm thử</th><th>Số ca</th><th>Đạt</th><th>Lỗi</th><th>Thời gian</th><th></th></tr>
${suites
  .map((s) => {
    const p = s.cases.filter((c) => c.status === 'passed').length;
    const f = s.cases.filter((c) => c.status === 'failed').length;
    return `<tr><td><code>${escapeHtml(s.name)}</code></td><td class="num">${s.cases.length}</td><td class="num">${p}</td><td class="num">${f}</td><td class="num">${(s.durationMs / 1000).toFixed(1)}s</td><td><span class="pill ${f ? 'bad' : 'ok'}">${f ? 'LỖI' : 'ĐẠT'}</span></td></tr>`;
  })
  .join('\n')}
</table></div></body></html>`;
fs.writeFileSync(path.join(outDir, 'test-report.html'), html);

console.log(
  `Đã dựng báo cáo trong ${outDir}/ — ${totals.passed}/${totals.tests} ca đạt (${passRate}%), ${totals.suites} bộ kiểm thử`,
);
