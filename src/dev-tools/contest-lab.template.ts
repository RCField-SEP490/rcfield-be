/**
 * Trang dựng dữ liệu giải đấu qua API thật.
 *
 * Viết bằng HTML/JS thuần, dựng phía server: công cụ nội bộ không đáng để kéo
 * theo một bước biên dịch, và để nó sống độc lập với giao diện chính — gỡ cả
 * module này đi không kéo theo thay đổi nào bên frontend.
 */

export const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;
     background:#0f172a;color:#e2e8f0;line-height:1.5;padding:24px}
.wrap{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1fr 420px;gap:20px}
@media(max-width:1000px){.wrap{grid-template-columns:1fr}}
h1{font-size:20px;font-weight:800;margin-bottom:4px}
.sub{font-size:13px;color:#94a3b8;margin-bottom:20px}
.head{grid-column:1/-1}
.panel{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;margin-bottom:14px}
.panel h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
          color:#94a3b8;margin-bottom:12px}
label{display:block;font-size:12px;color:#94a3b8;margin:8px 0 3px}
input,select,textarea{width:100%;padding:8px 10px;border-radius:7px;border:1px solid #475569;
       background:#0f172a;color:#e2e8f0;font-size:13px;font-family:inherit}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:12px;min-height:70px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.grid4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px}
@media(max-width:700px){.grid4{grid-template-columns:1fr 1fr}}
.picker{max-height:260px;overflow-y:auto;border:1px solid #2b3648;border-radius:8px;
        padding:8px;margin-top:8px;font-size:12px;background:#0e1626}
.picker label{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;
        cursor:pointer;margin:0;font-weight:400;text-transform:none;letter-spacing:0}
.picker label:hover{background:#182338}
.picker input[type=checkbox]{width:auto;margin:0;flex-shrink:0}
.picker .em{font-family:ui-monospace,Menlo,monospace}
.picker .nm{opacity:.55;margin-left:auto;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;max-width:44%}
.built{font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.8}
.built b{display:inline-block;min-width:130px}
.sc-ok{color:#15803d;font-weight:600}
.sc-bad{color:#b91c1c;font-weight:600}
button{padding:9px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;
       font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
button:hover{background:#1d4ed8}
button:disabled{background:#475569;cursor:not-allowed}
button.ghost{background:#334155}
button.ghost:hover{background:#475569}
button.warn{background:#b45309}
button.warn:hover{background:#92400e}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.step{border:1px solid #334155;border-radius:9px;padding:11px 13px;margin-bottom:8px;
      background:#0f172a;display:flex;align-items:center;gap:11px}
.step .n{width:24px;height:24px;border-radius:50%;background:#334155;color:#cbd5e1;
         font-size:12px;font-weight:700;display:grid;place-items:center;flex-shrink:0}
.step.ok .n{background:#16a34a;color:#fff}
.step.err .n{background:#dc2626;color:#fff}
.step.run .n{background:#2563eb;color:#fff}
.step .t{flex:1;min-width:0}
.step .t b{font-size:13px;font-weight:600;display:block}
.step .t code{font-size:11px;color:#64748b;font-family:ui-monospace,Menlo,monospace;
              display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.step .t .msg{font-size:11px;margin-top:2px}
.step.ok .msg{color:#4ade80}
.step.err .msg{color:#f87171}
#log{background:#020617;border:1px solid #334155;border-radius:10px;padding:12px;
     font-family:ui-monospace,Menlo,monospace;font-size:11px;height:520px;overflow:auto;
     white-space:pre-wrap;word-break:break-word}
.l-req{color:#60a5fa}.l-ok{color:#4ade80}.l-err{color:#f87171}.l-dim{color:#64748b}
.badge{display:inline-block;padding:2px 7px;border-radius:5px;font-size:11px;font-weight:700}
.badge.on{background:#14532d;color:#4ade80}
.badge.off{background:#450a0a;color:#f87171}
.hint{font-size:11px;color:#64748b;margin-top:6px}
`;

/**
 * Trang tham chiếu CSS và JS bằng đường dẫn cùng nguồn, KHÔNG nhúng nội tuyến.
 *
 * Helmet đặt `script-src 'self'` cho toàn bộ ứng dụng, nên thẻ <script> nội tuyến
 * bị chặn thẳng và trang chết lặng — không log, không lỗi mạng, chỉ là mọi thứ
 * không chạy. Tách ra file riêng thì `'self'` đã đủ, không phải nới CSP bằng
 * `unsafe-inline` như trang ngân hàng mô phỏng đang làm.
 *
 * `assetQuery` là chuỗi truy vấn gắn thêm vào đường dẫn CSS/JS. Khi trang bị
 * khoá bằng `DEV_TOOLS_TOKEN`, trình duyệt tải hai tệp con bằng lời gọi riêng
 * và KHÔNG tự mang theo khoá của trang cha — không truyền tiếp thì trang mở
 * được nhưng trắng trơn và câm lặng.
 */
export function renderContestLab(assetQuery = ''): string {
  return `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contest Lab · dựng dữ liệu giải đấu qua API</title>
<link rel="stylesheet" href="/dev-tools/contest-lab.css${assetQuery}">
</head><body>
<div class="wrap">
  <div class="head">
    <h1>Contest Lab</h1>
    <p class="sub">Dựng dữ liệu giải đấu bằng cách gọi đúng chuỗi API mà giao diện thật gọi —
       không chèn thẳng vào cơ sở dữ liệu, nên không sinh dữ liệu lệch trạng thái.</p>
  </div>

  <div>
    <div class="panel">
      <h2>1 · Tài khoản</h2>
      <label>Provider lấy đâu ra</label>
      <select id="pMode">
        <option value="existing">Dùng tài khoản có sẵn</option>
        <option value="new">Tạo mới qua API — KHÔNG dùng được nữa</option>
      </select>
      <div class="grid2">
        <div><label>Provider — email</label><input id="pEmail" value="provider@gmail.com"></div>
        <div><label>Provider — mật khẩu</label><input id="pPwd" value="123456"></div>
      </div>
      <div class="grid2">
        <div><label>Admin — email</label><input id="aEmail" value="admin@gmail.com"></div>
        <div><label>Admin — mật khẩu</label><input id="aPwd" value="123456"></div>
      </div>
      <p class="hint">Phải là provider đã có hồ sơ đối tác <b>được duyệt</b>, không thì mọi API
        của provider trả <code>ACCOUNT_NOT_ACTIVE</code>. Chế độ tạo mới đã ngừng hoạt động vì
        đăng ký đối tác nay đòi mã số thuế có thật và ba ảnh giấy tờ KYC.</p>
      <div class="row">
        <button class="ghost" id="btnProviderCafes">Đăng nhập &amp; nạp chi nhánh của provider này</button>
      </div>
      <p class="hint" id="provStatus">Chưa đăng nhập — ô chi nhánh ở mục 2 còn trống.
        Chi nhánh của provider khác không hiện ra, vì chọn nhầm là tạo giải bị từ chối.</p>
      <div class="grid2">
        <div><label>Mật khẩu chung của vận động viên</label><input id="athPwd" value="123456"></div>
        <div><label>&nbsp;</label>
          <p class="hint" style="margin:0">Ai khác mật khẩu thì viết
            <code>email:mật_khẩu</code> ở dòng của người đó.</p></div>
      </div>
      <label>Vận động viên</label>
      <div class="row">
        <button class="ghost" id="btnLoadCustomers">Chọn từ tài khoản có sẵn</button>
        <button class="ghost" id="btnPickAll">Chọn hết đang hiện</button>
        <button class="ghost" id="btnPickNone">Bỏ chọn</button>
        <input id="pickN" type="number" min="1" value="16" style="width:74px">
        <button class="ghost" id="btnPickRandom">Lấy ngẫu nhiên</button>
      </div>
      <input id="custSearch" placeholder="Lọc theo email hoặc tên…" style="margin-top:8px">
      <div id="custList" class="picker">Bấm <b>Chọn từ tài khoản có sẵn</b> để nạp danh sách.</div>
      <p class="hint" id="pickStatus">Chưa chọn ai.</p>
      <label>Email vận động viên — mỗi dòng một người</label>
      <textarea id="athletes">contest.customer1@gmail.com
contest.customer2@gmail.com
contest.customer3@gmail.com
contest.customer4@gmail.com</textarea>
      <p class="hint">Ô này vẫn là nguồn duy nhất công cụ đọc — chọn ở trên chỉ để điền nhanh vào đây,
        gõ tay hay dán thêm đều được. Tài khoản chưa tồn tại thì công cụ <b>tự đăng ký</b> qua API.</p>
    </div>

    <div class="panel">
      <h2>2 · Thông tin giải</h2>
      <div class="grid2">
        <div><label>Tên giải</label><input id="cName" value="Giải thử nghiệm"></div>
        <div><label>Sức chứa</label><input id="cCap" type="number" value="16"></div>
      </div>
      <div class="grid3">
        <div><label>Loại giải</label><select id="cType"></select></div>
        <div><label>Thể thức</label><select id="cFormat"></select></div>
        <div><label>Khuôn mẫu</label><select id="cTemplate"></select></div>
      </div>
      <div class="grid3">
        <div><label>Chi nhánh</label><select id="cCafe"></select></div>
        <div><label>Loại sân</label><select id="cTrack"></select></div>
        <div><label>Chính sách xe</label><select id="cPolicy">
          <option value="RENTAL_ONLY">Chỉ thuê xe quán</option>
          <option value="BYOC_ONLY">Chỉ mang xe riêng</option>
          <option value="MIXED">Cả hai</option>
        </select></div>
      </div>
      <div class="grid2">
        <div><label>Phí dự thi mỗi người (đ)</label><input id="cFee" type="number" value="0"></div>
        <div><label>Giải bắt đầu sau (ngày)</label><input id="cDays" type="number" value="7"></div>
      </div>
      <label>Ảnh xe cá nhân — dùng khi vận động viên mang xe riêng</label>
      <input id="byocPhoto"
        value="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTk0T_b5O3R4fn0f8nZ13zRY8TNzvPkkvQIPjxoqwzVdw&amp;s=10">
      <p class="hint">Gửi kèm lúc đăng ký và lúc điểm danh. Ban tổ chức duyệt xe cá nhân
        dựa vào ảnh này, nên bỏ trống là đăng ký thiếu căn cứ.</p>
      <div class="row"><button class="ghost" id="btnLoad">Nạp lại danh mục</button></div>
      <p class="hint" id="catStatus">Đang nạp danh mục…</p>
      <p class="hint" id="trackStatus">Loại sân lấy theo chi nhánh đang chọn.</p>
    </div>

    <div class="panel">
      <h2>Giải đã dựng trong phiên</h2>
      <div id="builtBox" class="hint">Chưa dựng giải nào.</div>
    </div>

    <div class="panel" id="resumePanel" style="display:none">
      <h2>Giải đang dở</h2>
      <p class="hint" id="resumeInfo" style="margin:0"></p>
      <div class="row">
        <button class="ghost" id="btnRefreshContest">Xem trạng thái hiện tại</button>
        <button class="warn" id="btnNewContest">Bỏ, bắt đầu giải mới</button>
      </div>
      <p class="hint">Bấm một nút ở mục dưới sẽ chạy tiếp trên chính giải này, không tạo giải mới.</p>
    </div>

    <div class="panel">
      <h2>3 · Dừng ở trạng thái nào</h2>
      <div class="row">
        <button class="ghost" data-goto="5">DRAFT — vừa tạo</button>
        <button class="ghost" data-goto="9">OPEN — đang mở đăng ký</button>
        <button class="ghost" data-goto="12">OPEN + đã duyệt VĐV</button>
        <button class="ghost" data-goto="14">CLOSED + đã điểm danh</button>
        <button class="ghost" data-goto="15">RUNNING — đã có trận</button>
        <button data-goto="17">COMPLETED — đủ kết quả</button>
      </div>
      <div class="row">
        <button class="warn" id="btnCancel">Huỷ giải vừa tạo</button>
        <button class="ghost" id="btnReset">Xoá trạng thái phiên</button>
      </div>
      <p class="hint">Mỗi nút chạy lần lượt từ bước 1 tới bước tương ứng rồi dừng.</p>
    </div>

    <div class="panel">
      <h2>4 · Chạy lô — dựng nhiều giải một lượt</h2>
      <p class="hint">Khai số giải cần cho từng trạng thái. Phần chuẩn bị (tài khoản, gói thuê bao,
        chi nhánh, danh mục) chỉ chạy <b>một lần</b> cho cả lô — mỗi giải sau đó dựng riêng.</p>
      <div class="grid4">
        <div><label>DRAFT</label><input id="bDraft" type="number" min="0" value="1"></div>
        <div><label>OPEN</label><input id="bOpen" type="number" min="0" value="1"></div>
        <div><label>OPEN + đã duyệt</label><input id="bApproved" type="number" min="0" value="0"></div>
        <div><label>CLOSED + điểm danh</label><input id="bClosed" type="number" min="0" value="0"></div>
      </div>
      <div class="grid4">
        <div><label>RUNNING</label><input id="bRunning" type="number" min="0" value="1"></div>
        <div><label>COMPLETED</label><input id="bCompleted" type="number" min="0" value="1"></div>
        <div><label>CANCELLED</label><input id="bCancelled" type="number" min="0" value="0"></div>
        <div><label>&nbsp;</label><button id="btnBatch" style="width:100%">Chạy lô</button></div>
      </div>
      <p class="hint" id="batchStatus">Đủ một bộ để mở màn danh sách giải và thử bộ lọc trạng thái.</p>
    </div>

    <div class="panel">
      <h2>5 · Kịch bản lệch đường</h2>
      <p class="hint">Đường hạnh phúc hiếm khi lộ bug. Mỗi nút dựng một giải <b>riêng</b> rồi cố ý
        đẩy nó chệch khỏi luồng chuẩn, và báo lại hệ thống phản ứng thế nào.</p>
      <div class="row">
        <button class="ghost" data-scenario="noshow">VĐV không điểm danh</button>
        <button class="ghost" data-scenario="withdraw">Bỏ cuộc giữa giải</button>
        <button class="ghost" data-scenario="cancelPaid">Huỷ giải sau khi đã thu phí dự thi</button>
        <button class="ghost" data-scenario="overCapacity">Đăng ký vượt sức chứa</button>
      </div>
      <div id="scResult" class="hint">Chưa chạy kịch bản nào.</div>
    </div>

    <div class="panel">
      <h2>6 · Các bước</h2>
      <div id="steps"></div>
    </div>
  </div>

  <div>
    <div class="panel" style="position:sticky;top:24px">
      <h2>Nhật ký gọi API</h2>
      <div id="log"><span class="l-dim">Chưa chạy bước nào.</span></div>
      <div class="row">
        <button class="ghost" id="btnClear">Xoá nhật ký</button>
        <button class="ghost" id="btnCopy">Chép nhật ký</button>
      </div>
      <div id="ctxBox" class="hint"></div>
    </div>
  </div>
</div>

<script src="/dev-tools/contest-lab.js${assetQuery}"></script>
</body></html>`;
}

/**
 * Toàn bộ phần chạy phía trình duyệt. Tách hằng riêng cho dễ đọc; nội dung là
 * JavaScript thuần chạy trực tiếp, không qua bước biên dịch nào.
 */
export const CLIENT_SCRIPT = String.raw`
const API = location.origin + '/api/v1';
const ctx = { athletes: [], registrations: [], matches: [] };

const $ = (id) => document.getElementById(id);
const logBox = $('log');

function log(kind, text) {
  const el = document.createElement('div');
  el.className = 'l-' + kind;
  el.textContent = text;
  if (logBox.firstChild && logBox.firstChild.classList && logBox.firstChild.classList.contains('l-dim')) {
    logBox.innerHTML = '';
  }
  logBox.appendChild(el);
  logBox.scrollTop = logBox.scrollHeight;
}

function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 400 ? s.slice(0, 400) + ' …' : s;
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  log('req', method + ' ' + path + (body ? '  ' + short(body) : ''));
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || ('HTTP ' + res.status);
    const code = json && json.code ? ' [' + json.code + ']' : '';
    log('err', '  ✗ ' + res.status + code + ' ' + msg);
    throw new Error(msg);
  }
  log('ok', '  ✓ ' + res.status + '  ' + short(json && json.data !== undefined ? json.data : json));
  return json && json.data !== undefined ? json.data : json;
}

const tokenOf = (r) => r.access_token || r.accessToken || (r.tokens && r.tokens.access_token);

async function login(email, password) {
  const r = await call('POST', '/auth/login', { email, password });
  return { token: tokenOf(r), user: r.user };
}

/**
 * Đăng nhập, chưa có tài khoản thì tạo rồi đăng nhập lại.
 *
 * Danh sách vận động viên mặc định là tài khoản do seed tạo ra; máy nào chưa
 * chạy seed thì chúng không tồn tại và cả bước đăng ký giải chết ngay từ dòng
 * đầu. Tạo qua đúng API đăng ký nên tài khoản sinh ra không khác gì người dùng
 * tự đăng ký.
 */
async function loginOrRegister(email, password, fullName) {
  // HỎI TRƯỚC, đừng thử đăng nhập rồi mới biết. Mỗi lần đăng nhập hụt cộng một
  // vào bộ đếm chống dò mật khẩu; 5 lần là email đó bị khoá 15 phút. Chạy công
  // cụ vài lượt khi tài khoản chưa tồn tại là tự khoá chính mình, và thông báo
  // "Tài khoản bị khoá" khiến người dùng tưởng dữ liệu hỏng.
  const exists = await call('POST', '/auth/check-exists', { email });
  if (!exists.emailExists) {
    log('dim', '  (chưa có tài khoản ' + email + ' — tạo mới qua /auth/register)');
    await call('POST', '/auth/register', {
      full_name: fullName, email, password, role: 'CUSTOMER',
    });
    const fresh = await login(email, password);
    return { ...fresh, createdNow: true };
  }

  try {
    return await login(email, password);
  } catch (e) {
    if (/ACCOUNT_LOCKED|bị khoá/i.test(e.message)) {
      throw new Error('Email ' + email + ' đang bị khoá tạm do đăng nhập sai 5 lần. ' +
        'Chờ 15 phút, hoặc xoá bộ đếm: docker exec rcfeild_redis redis-cli del "auth:failed:' +
        email + '"');
    }
    if (/INVALID_CREDENTIALS|không đúng/i.test(e.message)) {
      throw new Error('Tài khoản ' + email + ' có tồn tại nhưng mật khẩu không đúng. ' +
        'Sửa ô mật khẩu chung, hoặc ghi "' + email + ':mật_khẩu_đúng" ở dòng đó.');
    }
    throw e;
  }
}

/**
 * Tên người dùng cho tài khoản công cụ tự tạo.
 *
 * Đặt "Vận động viên 1" thì mọi màn hình vận hành đều hiện đúng chuỗi đó, và
 * người xem tưởng giao diện đang in nhãn chung thay vì tên thật. Tên người Việt
 * có dấu còn kiểm luôn được phần hiển thị chữ có dấu ở bảng và biên bản.
 */
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Vũ', 'Đặng',
  'Bùi', 'Đỗ', 'Ngô', 'Dương'];
const DEM = ['Văn', 'Thị', 'Hoàng', 'Minh', 'Quốc', 'Gia', 'Khánh', 'Thanh'];
const TEN = ['An', 'Bảo', 'Cường', 'Dũng', 'Hà', 'Hùng', 'Khoa', 'Linh',
  'Long', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Trang', 'Tuấn', 'Vy'];

function fakeVietnameseName(seed) {
  return HO[seed % HO.length] + ' ' +
    DEM[(seed * 3) % DEM.length] + ' ' +
    TEN[(seed * 7) % TEN.length];
}

/** Một dòng vận động viên: "email" hoặc "email:mật_khẩu". */
function parseAthlete(line) {
  const at = line.indexOf('@');
  const sep = line.indexOf(':', at < 0 ? 0 : at);
  if (sep < 0) return { email: line.trim(), password: $('athPwd').value };
  return { email: line.slice(0, sep).trim(), password: line.slice(sep + 1).trim() };
}

/**
 * Điểm danh MỘT đăng ký.
 *
 * Tách khỏi bước điểm danh vì kịch bản "vắng mặt" cần điểm danh có chọn lọc.
 * Chép thành hai bản thì sớm muộn cũng lệch nhau, và bản trong kịch bản sẽ là
 * bản lặng lẽ sai.
 */
async function checkInOne(r) {
  const body = { checked_in_cafe_id: ctx.cafeId };
  // Xét theo TỪNG đăng ký, không theo chính sách của giải: giải hỗn hợp có cả
  // người thuê xe lẫn người mang xe riêng, mỗi loại cần dữ liệu khác nhau.
  const isByoc = r.source === 'BYOC' || $('cPolicy').value === 'BYOC_ONLY';
  if (isByoc) {
    body.byoc_confirmed = true;
    // Nhận xe cá nhân bắt buộc có bằng chứng: tối thiểu 2 ảnh và đủ ba hạng mục
    // thân xe, hệ truyền động, bánh. Thiếu là 400, không phải cảnh báo.
    const photo = $('byocPhoto').value.trim() ||
      'https://placehold.co/600x400/png?text=BYOC';
    body.byoc_inspection = {
      // Dùng cùng một ảnh cho hai góc là chấp nhận được ở môi trường thử, miễn
      // là ảnh có thật và tải được.
      photos: [
        { url: photo, angle: 'FRONT' },
        { url: photo, angle: 'REAR' },
      ],
      checklist: [
        { itemKey: 'body', itemLabel: 'Thân xe', status: 'OK' },
        { itemKey: 'power_system', itemLabel: 'Hệ truyền động', status: 'OK' },
        { itemKey: 'wheels', itemLabel: 'Bánh xe', status: 'OK' },
      ],
    };
  } else {
    const units = await call('GET', '/contest-registrations/' + r.id + '/handover-units',
      null, ctx.providerToken);
    const rows = units.data || units;
    const unit = Array.isArray(rows) ? rows[0] : null;
    if (unit) body.rental_vehicle_id = unit.vehicle_id || unit.id;
  }
  await call('POST', '/contest-registrations/' + r.id + '/check-in', body, ctx.providerToken);
}

/** Phí dự thi đang thật sự áp dụng — ghi đè của kịch bản thắng giá trị trên form. */
function effectiveEntryFee() {
  const ov = ctx.overrides || {};
  return ov.entry_fee !== undefined ? Number(ov.entry_fee) : Number($('cFee').value);
}

function isoIn(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function fillSelect(id, rows, labelKey) {
  const sel = $(id);
  sel.innerHTML = '';
  if (!rows || !rows.length) {
    // Ô rỗng trơ không mở ra được gì, người dùng tưởng trang hỏng. Luôn để lại
    // một dòng nói rõ tình trạng.
    const o = document.createElement('option');
    o.value = ''; o.textContent = '(chưa nạp được dữ liệu)'; o.disabled = true;
    sel.appendChild(o);
    return;
  }
  rows.forEach((r) => {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r[labelKey] || r.name || r.code || r.id;
    sel.appendChild(o);
  });
}

// ── Các bước ─────────────────────────────────────────────────────────────────
// Mỗi bước là một mắt xích: chạy xong ghi kết quả vào ctx cho bước sau dùng.
const STEPS = [
  {
    name: 'Chuẩn bị tài khoản provider và admin',
    api: 'POST /auth/login · /auth/register-provider · /admin/providers/:id/approve',
    run: async () => {
      const a = await login($('aEmail').value, $('aPwd').value);
      ctx.adminToken = a.token;

      if ($('pMode').value === 'new') {
        // Chế độ này KHÔNG còn chạy được, và nó hỏng vì hai chốt chặn thật chứ
        // không phải vì công cụ viết sai:
        //
        //  1. /auth/register-provider đối chiếu mã số thuế với dữ liệu Cục Thuế
        //     qua VietQR. Mã sinh từ dấu thời gian không có thật, luôn ăn
        //     TAX_CODE_NOT_FOUND.
        //  2. Hồ sơ còn bắt buộc ba ảnh giấy tờ KYC gửi dạng multipart. Công cụ
        //     gửi JSON nên kể cả qua được mã số thuế vẫn dừng ở MISSING_DOCUMENTS.
        //
        // Cả hai đều đúng — không nên nới ra chỉ để công cụ thử chạy được. Nên
        // báo thẳng thay vì để người dùng nhận lỗi mã số thuế và tưởng mình gõ sai.
        throw new Error('Chế độ "tạo mới qua API" không dùng được nữa: đăng ký đối tác ' +
          'bắt buộc mã số thuế CÓ THẬT (đối chiếu Cục Thuế) và ba ảnh giấy tờ KYC. ' +
          'Hãy chọn "Dùng tài khoản có sẵn" với một provider đã được duyệt.');
      }

      const p = await login($('pEmail').value, $('pPwd').value);
      ctx.providerToken = p.token; ctx.providerId = p.user.id;
      return 'provider ' + p.user.id.slice(0, 8) + '…';
    },
  },
  {
    name: 'Bảo đảm provider có gói thuê bao còn hiệu lực',
    api: 'GET /provider/subscription → POST /provider/payment-requests → admin confirm',
    run: async () => {
      let sub;
      try {
        sub = await call('GET', '/provider/subscription', null, ctx.providerToken);
      } catch (e) {
        if (/chưa hoàn thành đăng ký|chưa được phê duyệt/i.test(e.message)) {
          throw new Error('Tài khoản này chưa có hồ sơ đối tác được duyệt nên mọi API ' +
            'provider đều bị chặn. Đổi ô "Provider lấy đâu ra" sang "Tạo mới qua API" rồi chạy lại.');
        }
        throw e;
      }
      const status = sub && (sub.status || (sub.subscription && sub.subscription.status));
      if (status && ['ACTIVE', 'TRIAL', 'GRACE_PERIOD'].includes(status)) {
        return 'đã có gói ' + status + ', bỏ qua thanh toán';
      }
      const plans = await call('GET', '/subscription-plans');
      const list = plans.data || plans;
      const plan = list.find((p) => p.name !== 'TRIAL') || list[0];
      const amount = Number(plan.price_per_month || plan.pricePerMonth || 0);
      const req = await call('POST', '/provider/payment-requests', {
        plan_id: plan.id,
        transfer_reference: 'LAB' + Date.now(),
        transfer_date: new Date().toISOString().slice(0, 10),
        transfer_amount: amount,
      }, ctx.providerToken);
      const id = req.id || (req.payment_request && req.payment_request.id);
      await call('POST', '/admin/payment-requests/' + id + '/confirm', {}, ctx.adminToken);
      return 'đã kích hoạt gói ' + plan.name;
    },
  },
  {
    name: 'Tạo chi nhánh nếu provider chưa có cái nào',
    api: 'GET /cafes → POST /cafes',
    run: async () => {
      const owned = await loadMyCafes();
      if (owned.length) return 'đã có ' + owned.length + ' chi nhánh, ô chọn đã lọc lại';

      const tracks = await call('GET', '/track-types');
      const trackRows = Array.isArray(tracks) ? tracks : tracks.data || [];
      const hours = {};
      ['sun','mon','tue','wed','thu','fri','sat'].forEach((d) => {
        hours[d] = { open: '08:00', close: '22:00', is_closed: false };
      });
      const cafe = await call('POST', '/cafes/', {
        name: 'Sân Lab ' + Date.now(),
        description: 'Chi nhánh do Contest Lab tạo để thử nghiệm',
        address: '1 Đường Thử Nghiệm',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
        latitude: 10.7769, longitude: 106.7009,
        operating_hours: hours,
        track_types: trackRows.slice(0, 1).map((t) => t.id),
        slot_duration_minutes: 60,
        slot_fee_rate: 50000,
      }, ctx.providerToken);
      ctx.cafeId = cafe.id;
      fillSelect('cCafe', [cafe], 'name');
      await loadTrackTypesForCafe();
      return 'đã tạo chi nhánh ' + cafe.id.slice(0, 8) + '…';
    },
  },
  {
    name: 'Nạp danh mục loại giải, thể thức, khuôn mẫu, chi nhánh, loại sân',
    api: 'GET /contest-catalog/* · /cafes · /track-types',
    run: async () => {
      await loadCatalog();
      return 'đã nạp';
    },
  },
  {
    name: 'Tạo giải — trạng thái DRAFT',
    api: 'POST /contests',
    run: async () => {
      // Đã có giải dang dở thì dùng lại, đừng tạo cái mới. Người dùng bấm nút
      // trạng thái là muốn ĐẨY giải đó đi tiếp, không phải sinh thêm một giải
      // nữa mỗi lần chạy.
      if (ctx.contestId) {
        const cur = await call('GET', '/contests/' + ctx.contestId, null, ctx.providerToken);
        ctx.cafeId = ctx.cafeId || $('cCafe').value;
        return 'dùng lại giải đang dở — ' + cur.status + ' ' + ctx.contestId.slice(0, 8) + '…';
      }
      const days = Number($('cDays').value);
      // Chạy lô và kịch bản lệch cần đổi vài tham số so với ô nhập trên form —
      // ví dụ sức chứa nhỏ hơn số người để kiểm chốt chặn. Ghi đè qua ctx thay
      // vì sửa giá trị trong ô, để form người dùng gõ không bị thay ngầm.
      const ov = ctx.overrides || {};
      const body = {
        name: $('cName').value +
          (ctx.nameSuffix ? ' — ' + ctx.nameSuffix : '') +
          ' ' + new Date().toLocaleTimeString('vi-VN'),
        contest_type_id: $('cType').value,
        contest_format_id: $('cFormat').value,
        contest_template_id: $('cTemplate').value,
        track_type_id: $('cTrack').value,
        participating_cafe_ids: [$('cCafe').value],
        starts_at: isoIn(days, 9),
        ends_at: isoIn(days, 18),
        // Mốc mở đăng ký phải nằm trong QUÁ KHỨ, nếu không vận động viên đăng ký
        // ngay sau đó sẽ ăn CONTEST_REGISTRATION_NOT_OPEN_YET — công cụ dựng dữ
        // liệu thì không ai muốn ngồi chờ tới đúng giờ.
        registration_opens_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        registration_closes_at: isoIn(days - 1 > 0 ? days - 1 : 1, 20),
        capacity: ov.capacity !== undefined ? ov.capacity : Number($('cCap').value),
        entry_fee: ov.entry_fee !== undefined ? ov.entry_fee : Number($('cFee').value),
        vehicle_rule: { vehicle_policy: $('cPolicy').value, assignment_policy: 'AT_CHECK_IN' },
      };
      const c = await call('POST', '/contests', body, ctx.providerToken);
      ctx.contestId = c.id;
      ctx.cafeId = $('cCafe').value;
      return 'contest ' + c.id.slice(0, 8) + '… trạng thái ' + c.status;
    },
  },
  {
    name: 'Đặt gói tổ chức giải',
    api: 'GET /contest-fee-plans → POST /contests/:id/fee/order',
    run: async () => {
      const st = await call('GET', '/contests/' + ctx.contestId + '/fee', null, ctx.providerToken);
      if (st && (st.status === 'PAID' || st.payment_status === 'PAID' || st.required === false)) {
        ctx.feeSkipped = true;
        return 'giải này không phải trả phí, bỏ qua';
      }
      const plans = await call('GET', '/contest-fee-plans', null, ctx.providerToken);
      const list = plans.data || plans;
      if (!list.length) { ctx.feeSkipped = true; return 'không có gói phí nào, bỏ qua'; }
      const order = await call('POST', '/contests/' + ctx.contestId + '/fee/order',
        { plan_id: list[0].id }, ctx.providerToken);
      ctx.feeOrderId = order.id || (order.order && order.order.id);
      ctx.feeAmount = Number(order.amount || order.total_amount || list[0].price || 0);
      return 'đơn phí ' + String(ctx.feeOrderId).slice(0, 8) + '…';
    },
  },
  {
    name: 'Khai báo đã chuyển khoản phí tổ chức',
    api: 'POST /contests/:id/fee/transfer',
    run: async () => {
      if (ctx.feeSkipped) return 'bỏ qua';
      await call('POST', '/contests/' + ctx.contestId + '/fee/transfer', {
        transfer_reference: 'LABFEE' + Date.now(),
        transfer_date: new Date().toISOString().slice(0, 10),
        transfer_amount: ctx.feeAmount > 0 ? ctx.feeAmount : 1000,
      }, ctx.providerToken);
      return 'đã khai báo';
    },
  },
  {
    name: 'Admin xác nhận đã nhận phí',
    api: 'POST /admin/contest-fee-orders/:id/confirm',
    run: async () => {
      if (ctx.feeSkipped) return 'bỏ qua';
      await call('POST', '/admin/contest-fee-orders/' + ctx.feeOrderId + '/confirm',
        { notes: 'Xác nhận từ Contest Lab' }, ctx.adminToken);
      return 'đã xác nhận';
    },
  },
  {
    name: 'Mở đăng ký — DRAFT sang OPEN',
    api: 'POST /contests/:id/open',
    run: async () => {
      const c = await call('POST', '/contests/' + ctx.contestId + '/open', {}, ctx.providerToken);
      return 'trạng thái ' + c.status;
    },
  },
  {
    name: 'Vận động viên đăng ký',
    api: 'POST /contests/:id/register  (mỗi người một lần)',
    run: async () => {
      const lines = $('athletes').value.split('\n').map((s) => s.trim()).filter(Boolean);
      ctx.athletes = []; ctx.registrations = [];
      const policy = $('cPolicy').value;

      let created = 0;
      for (const [i, line] of lines.entries()) {
        const { email, password } = parseAthlete(line);
        const a = await loginOrRegister(email, password, fakeVietnameseName(i));
        ctx.athletes.push({ email, token: a.token, userId: a.user.id });
        if (a.createdNow) created += 1;
      }
      if (created) log('dim', '  (đã tạo mới ' + created + ' tài khoản)');

      let catalogs = [];
      if (policy !== 'BYOC_ONLY') {
        // Danh sách xe cho thuê của giải là endpoint DÀNH CHO KHÁCH — gọi bằng
        // token provider sẽ ăn 403. Dùng token của vận động viên đầu tiên.
        const opts = await call('GET', '/contests/' + ctx.contestId + '/rental-options',
          null, ctx.athletes[0].token);
        // Trả về một object gồm cafes / track_configs / vehicle_catalogs, không
        // phải mảng phẳng.
        const all = (opts && opts.vehicle_catalogs) || [];
        catalogs = all.filter((v) => v.cafe_id === ctx.cafeId);
        if (!catalogs.length) catalogs = all;
        if (!catalogs.length && policy === 'RENTAL_ONLY') {
          throw new Error('Chi nhánh này chưa có dòng xe nào cho thuê — chọn chi nhánh ' +
            'khác, hoặc đổi chính sách xe sang "Chỉ mang xe riêng".');
        }
      }

      const byocBody = (email) => {
        const body = {
          vehicle_source: 'BYOC',
          byoc_vehicle_name: 'Xe test ' + email.split('@')[0],
          byoc_vehicle_brand: 'Traxxas',
          byoc_vehicle_class: 'Buggy 1/10',
        };
        const photo = $('byocPhoto').value.trim();
        if (photo) body.byoc_vehicle_photos = [photo];
        return body;
      };

      let idx = 0;
      ctx.capacityRejected = [];
      for (const a of ctx.athletes) {
        const email = a.email;
        let r = null;

        try {
        if (policy === 'BYOC_ONLY') {
          r = await call('POST', '/contests/' + ctx.contestId + '/register',
            byocBody(email), a.token);
        } else {
          // Mỗi dòng xe chỉ có đúng số xe quán đang sở hữu, nên bốn người cùng
          // chọn một dòng là người thứ hai đã hết suất. Xoay vòng qua các dòng,
          // hết sạch thì lùi về xe cá nhân nếu giải cho phép.
          let lastErr = null;
          for (let k = 0; k < catalogs.length && !r; k++) {
            const cat = catalogs[(idx + k) % catalogs.length];
            try {
              r = await call('POST', '/contests/' + ctx.contestId + '/register', {
                vehicle_source: 'RENTAL',
                rental: { cafe_id: ctx.cafeId, vehicle_catalog_id: cat.id },
              }, a.token);
              idx = (idx + k + 1) % catalogs.length;
            } catch (e) {
              lastErr = e;
              if (!/hết suất|FULL/i.test(e.message)) throw e;
            }
          }
          if (!r && policy === 'MIXED') {
            log('dim', '  (hết xe cho thuê — ' + email + ' chuyển sang mang xe riêng)');
            r = await call('POST', '/contests/' + ctx.contestId + '/register',
              byocBody(email), a.token);
          }
          if (!r) {
            throw new Error('Hết suất thuê xe ở mọi dòng xe của chi nhánh. Đội xe của quán ' +
              'nhỏ hơn số vận động viên — giảm số người, đổi chính sách xe sang ' +
              '"Cả hai" để tự lùi về xe cá nhân, hoặc chọn chi nhánh có nhiều xe hơn.');
          }
        }
        } catch (e) {
          // Kịch bản "vượt sức chứa" cố tình đăng ký nhiều hơn số suất, nên bị
          // chặn ở đây là KẾT QUẢ MONG ĐỢI chứ không phải hỏng. Chỉ nuốt đúng
          // lỗi đó — mọi lỗi khác vẫn phải nổ ra, không thì kịch bản báo đạt
          // trong khi thật ra nó chết vì lý do chẳng liên quan.
          if (ctx.expectCapacity && /CONTEST_CAPACITY_REACHED|đủ sức chứa/i.test(e.message)) {
            ctx.capacityRejected.push(email);
            log('dim', '  (bị chặn đúng như mong đợi — giải đã đủ chỗ)');
            continue;
          }
          throw e;
        }
        ctx.registrations.push({ id: r.id, email, status: r.status,
          source: r.vehicle_source || r.vehicleSource });
      }
      return ctx.registrations.length + ' người đã đăng ký' +
        (ctx.capacityRejected.length ? ', ' + ctx.capacityRejected.length + ' người bị chặn vì hết chỗ' : '');
    },
  },
  {
    name: 'Xử lý phí dự thi — miễn phí cho nhanh',
    api: 'POST /contest-registrations/:id/waive-entry-fee',
    run: async () => {
      if (effectiveEntryFee() <= 0) return 'giải không thu phí, bỏ qua';
      for (const r of ctx.registrations) {
        await call('POST', '/contest-registrations/' + r.id + '/waive-entry-fee',
          { note: 'Miễn phí từ Contest Lab' }, ctx.providerToken);
      }
      return 'đã miễn phí cho ' + ctx.registrations.length + ' người';
    },
  },
  {
    name: 'Duyệt đăng ký',
    api: 'POST /contest-registrations/:id/approve',
    run: async () => {
      for (const r of ctx.registrations) {
        await call('POST', '/contest-registrations/' + r.id + '/approve', {}, ctx.providerToken);
      }
      return 'đã duyệt ' + ctx.registrations.length + ' người';
    },
  },
  {
    name: 'Đóng đăng ký — OPEN sang CLOSED',
    api: 'POST /contests/:id/close',
    run: async () => {
      const c = await call('POST', '/contests/' + ctx.contestId + '/close', {}, ctx.providerToken);
      return 'trạng thái ' + c.status;
    },
  },
  {
    name: 'Điểm danh vận động viên',
    api: 'POST /contest-registrations/:id/check-in',
    run: async () => {
      for (const r of ctx.registrations) await checkInOne(r);
      return 'đã điểm danh ' + ctx.registrations.length + ' người';
    },
  },
  {
    name: 'Sinh trận đấu — chuyển sang RUNNING',
    api: 'POST /contests/:id/matches/generate',
    run: async () => {
      const res = await call('POST', '/contests/' + ctx.contestId + '/matches/generate',
        { cafe_id: ctx.cafeId, seeding_mode: 'CHECK_IN_ORDER' }, ctx.providerToken);
      const rows = res.data || res.matches || res;
      ctx.matches = Array.isArray(rows) ? rows : [];
      return 'đã sinh ' + ctx.matches.length + ' trận';
    },
  },
  {
    name: 'Nhập kết quả từng trận',
    api: 'POST /contest-matches/:id/results  →  /advance',
    run: async () => {
      const all = await call('GET', '/contests/' + ctx.contestId + '/matches',
        null, ctx.providerToken);
      const rows = all.data || all;
      let done = 0;
      for (const m of rows) {
        const parts = m.participants || [];
        if (!parts.length) continue;
        if (m.status === 'COMPLETED') continue;
        const results = parts.map((p, i) => ({
          registration_id: p.registration_id || p.registrationId,
          finish_position: i + 1,
          is_winner: i === 0,
          total_time_seconds: 60 + i * 3,
        }));
        // Trường reason là BẮT BUỘC trong schema nhập kết quả — mọi lần ghi kết
        // quả đều phải nêu căn cứ, để sau này còn truy được ai ghi và ghi theo gì.
        await call('POST', '/contest-matches/' + m.id + '/results',
          { results, reason: 'Kết quả dựng bằng Contest Lab' }, ctx.providerToken);
        try {
          await call('POST', '/contest-matches/' + m.id + '/advance', {}, ctx.providerToken);
        } catch (e) { log('dim', '  (trận cuối không có vòng sau — bỏ qua advance)'); }
        done++;
      }
      return 'đã nhập kết quả ' + done + ' trận';
    },
  },
  {
    name: 'Công bố bảng xếp hạng — COMPLETED',
    api: 'POST /contests/:id/leaderboard/publish',
    run: async () => {
      await call('POST', '/contests/' + ctx.contestId + '/leaderboard/publish', {},
        ctx.providerToken);
      const c = await call('GET', '/contests/' + ctx.contestId, null, ctx.providerToken);
      return 'trạng thái ' + c.status;
    },
  },
];

// ── Giao diện ────────────────────────────────────────────────────────────────
function renderSteps() {
  const box = $('steps');
  box.innerHTML = '';
  STEPS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'step';
    el.id = 'step' + i;
    el.innerHTML = '<div class="n">' + (i + 1) + '</div>' +
      '<div class="t"><b>' + s.name + '</b><code>' + s.api + '</code>' +
      '<div class="msg"></div></div>';
    const btn = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = 'Chạy';
    btn.onclick = () => runOne(i);
    el.appendChild(btn);
    box.appendChild(el);
  });
}

function mark(i, cls, msg) {
  const el = $('step' + i);
  el.className = 'step ' + cls;
  el.querySelector('.msg').textContent = msg || '';
}

function showCtx() {
  const bits = [];
  if (ctx.contestId) bits.push('contest ' + ctx.contestId);
  if (ctx.registrations.length) bits.push(ctx.registrations.length + ' đăng ký');
  if (ctx.matches.length) bits.push(ctx.matches.length + ' trận');
  $('ctxBox').textContent = bits.join('  ·  ');
}

async function runOne(i) {
  mark(i, 'run', 'đang chạy…');
  try {
    const msg = await STEPS[i].run();
    mark(i, 'ok', msg);
    showCtx(); showResume(); saveState();
    return true;
  } catch (e) {
    mark(i, 'err', e.message);
    return false;
  }
}

async function runTo(n) {
  for (let i = 0; i < n; i++) {
    const ok = await runOne(i);
    if (!ok) { log('err', 'Dừng ở bước ' + (i + 1) + '.'); return; }
  }
  log('ok', '── Xong ' + n + ' bước ──');
}

// ── Chỉ số bước ──────────────────────────────────────────────────────────────
// Chạy lô và kịch bản lệch đều cần nhảy vào giữa chuỗi bước. Đếm tay thì mỗi
// lần chèn một bước là mọi chỗ gọi lệch đi một mà không có gì báo.
const STEP = {
  PRELUDE_END: 4, // 0–3: tài khoản · gói thuê bao · chi nhánh · danh mục
  CREATE: 4,
  FEE_ORDER: 5, FEE_TRANSFER: 6, FEE_CONFIRM: 7,
  OPEN: 8,
  REGISTER: 9,
  ENTRY_FEE: 10,
  APPROVE: 11,
  CLOSE: 12,
  CHECKIN: 13,
  GENERATE: 14,
  RESULTS: 15,
  PUBLISH: 16,
};

/** Chạy các bước [from, to) — hỏng bước nào thì dừng và ném lỗi ra ngoài. */
async function runRange(from, to) {
  for (let i = from; i < to; i++) {
    const ok = await runOne(i);
    if (!ok) throw new Error('dừng ở bước ' + (i + 1) + ' — ' + STEPS[i].name);
  }
}

/** Bỏ giải hiện tại khỏi phiên để lượt sau dựng một giải mới hoàn toàn. */
function resetContest() {
  ctx.contestId = null; ctx.registrations = []; ctx.matches = [];
  ctx.feeOrderId = null; ctx.feeSkipped = false;
  ctx.overrides = null; ctx.nameSuffix = ''; ctx.expectCapacity = false;
  ctx.capacityRejected = [];
}

/** Danh sách giải đã dựng trong phiên, để còn tìm lại được sau khi chạy lô. */
function noteBuilt(id, label) {
  ctx.built = ctx.built || [];
  ctx.built.unshift({ id, label, at: new Date().toLocaleTimeString('vi-VN') });
  renderBuilt();
}

function renderBuilt() {
  const box = $('builtBox');
  const rows = ctx.built || [];
  if (!rows.length) { box.textContent = 'Chưa dựng giải nào.'; return; }
  box.className = 'built';
  box.innerHTML = rows.map((r) =>
    '<div><b>' + r.label + '</b> ' + r.id + '  <span style="opacity:.6">' + r.at + '</span></div>'
  ).join('');
}

// ── Chạy lô ──────────────────────────────────────────────────────────────────
// Muốn thử màn danh sách giải và bộ lọc trạng thái thì cần nhiều giải ở nhiều
// trạng thái cùng lúc. Chạy tay từng cái là điền lại form mỗi lượt, nên phần
// chuẩn bị được tách ra chạy đúng một lần rồi mới lặp phần dựng giải.
const BATCH = [
  { input: 'bDraft', label: 'DRAFT', to: STEP.CREATE + 1 },
  { input: 'bOpen', label: 'OPEN', to: STEP.OPEN + 1 },
  { input: 'bApproved', label: 'OPEN + đã duyệt', to: STEP.APPROVE + 1 },
  { input: 'bClosed', label: 'CLOSED + điểm danh', to: STEP.CHECKIN + 1 },
  { input: 'bRunning', label: 'RUNNING', to: STEP.GENERATE + 1 },
  { input: 'bCompleted', label: 'COMPLETED', to: STEP.PUBLISH + 1 },
  // Huỷ phải có gì đó để mà huỷ — dựng tới lúc đã duyệt xong người tham gia,
  // rồi mới huỷ, thì mới chạm được phần xử lý người đã ghi danh.
  { input: 'bCancelled', label: 'CANCELLED', to: STEP.APPROVE + 1, cancel: true },
];

async function runBatch() {
  const plan = [];
  BATCH.forEach((b) => {
    const n = Number($(b.input).value) || 0;
    for (let i = 0; i < n; i++) plan.push(b);
  });
  if (!plan.length) {
    $('batchStatus').textContent = 'Chưa khai số giải nào — điền ít nhất một ô rồi bấm lại.';
    return;
  }

  const st = $('batchStatus');
  st.textContent = 'Đang chuẩn bị tài khoản và chi nhánh…';
  log('dim', '── Chạy lô: ' + plan.length + ' giải ──');

  try {
    await runRange(0, STEP.PRELUDE_END);
  } catch (e) {
    st.textContent = 'Phần chuẩn bị hỏng nên không dựng được giải nào: ' + e.message;
    log('err', 'Chạy lô dừng ở phần chuẩn bị.');
    return;
  }

  const done = [];
  const failed = [];
  for (const [i, item] of plan.entries()) {
    st.textContent = 'Giải ' + (i + 1) + '/' + plan.length + ' — đang dựng ' + item.label + '…';
    resetContest();
    ctx.nameSuffix = item.label + ' #' + (i + 1);
    try {
      await runRange(STEP.CREATE, item.to);
      if (item.cancel) {
        await call('POST', '/contests/' + ctx.contestId + '/cancel', {}, ctx.providerToken);
        log('ok', '  đã huỷ giải ' + ctx.contestId.slice(0, 8) + '…');
      }
      noteBuilt(ctx.contestId, item.label);
      done.push(item.label);
    } catch (e) {
      failed.push(item.label + ' (' + e.message + ')');
      log('err', 'Giải ' + (i + 1) + ' hỏng: ' + e.message);
    }
  }

  saveState();
  const counts = {};
  done.forEach((l) => { counts[l] = (counts[l] || 0) + 1; });
  const summary = Object.keys(counts).map((k) => counts[k] + ' ' + k).join(' · ');
  st.textContent = 'Đã dựng ' + done.length + '/' + plan.length + ' giải' +
    (summary ? ' — ' + summary : '') +
    (failed.length ? '. Hỏng: ' + failed.join('; ') : '.');
  log(failed.length ? 'err' : 'ok', '── Chạy lô xong: ' + done.length + '/' + plan.length + ' ──');
}

// ── Kịch bản lệch đường ──────────────────────────────────────────────────────
// Mười bảy bước ở trên đều đi đường hạnh phúc, mà lỗi hiếm khi nằm ở đó. Bốn
// kịch bản dưới đây cố ý đẩy giải chệch khỏi luồng chuẩn và ghi lại hệ thống
// phản ứng ra sao.
//
// Hai kịch bản đầu là DỰNG DỮ LIỆU — sinh ra trạng thái khó dựng bằng tay, còn
// đúng sai thì người xem tự đánh giá trên giao diện. Hai kịch bản sau có KẾT
// LUẬN ĐẠT/KHÔNG ĐẠT, vì chúng kiểm một chốt chặn cụ thể.

function scSay(html) { $('scResult').innerHTML = html; }
const scOk = (t) => '<span class="sc-ok">' + t + '</span>';
const scBad = (t) => '<span class="sc-bad">' + t + '</span>';

async function fetchMatches() {
  const all = await call('GET', '/contests/' + ctx.contestId + '/matches', null, ctx.providerToken);
  const rows = all.data || all;
  return Array.isArray(rows) ? rows : [];
}

const SCENARIOS = {
  noshow: {
    label: 'VĐV không điểm danh',
    run: async () => {
      await runRange(0, STEP.PRELUDE_END);
      resetContest();
      ctx.nameSuffix = 'no-show';
      await runRange(STEP.CREATE, STEP.CLOSE + 1);

      if (ctx.registrations.length < 2) throw new Error('Cần ít nhất 2 vận động viên');
      const absent = ctx.registrations[ctx.registrations.length - 1];
      const present = ctx.registrations.slice(0, -1);
      for (const r of present) await checkInOne(r);
      log('dim', '  (' + absent.email + ' cố tình KHÔNG điểm danh)');

      await runRange(STEP.GENERATE, STEP.GENERATE + 1);
      const matches = await fetchMatches();
      const inBracket = matches.some((m) => (m.participants || []).some(
        (p) => (p.registration_id || p.registrationId) === absent.id));

      noteBuilt(ctx.contestId, 'RUNNING (thiếu 1 người)');
      scSay('<b>VĐV không điểm danh</b> — ' + present.length + '/' +
        ctx.registrations.length + ' người có mặt, đã sinh ' + matches.length + ' trận.<br>' +
        'Người vắng ' + (inBracket
          ? scBad('VẪN nằm trong bảng đấu') + ' — nhánh đấu đang chờ một người không tới.'
          : scOk('đã bị loại khỏi bảng đấu') + ' — bảng chỉ gồm người đã điểm danh.') +
        '<br>Giải ' + ctx.contestId);
    },
  },

  withdraw: {
    label: 'Bỏ cuộc giữa giải',
    run: async () => {
      await runRange(0, STEP.PRELUDE_END);
      resetContest();
      ctx.nameSuffix = 'bo-cuoc';
      await runRange(STEP.CREATE, STEP.GENERATE + 1);

      const before = await fetchMatches();
      const quitter = ctx.registrations[0];
      const theirMatch = before.find((m) => (m.participants || []).some(
        (p) => (p.registration_id || p.registrationId) === quitter.id));

      await call('POST', '/contest-registrations/' + quitter.id + '/cancel',
        { reason: 'Bỏ cuộc giữa giải — dựng bằng Contest Lab' }, ctx.providerToken);

      const after = await fetchMatches();
      const stillThere = after.some((m) => (m.participants || []).some(
        (p) => (p.registration_id || p.registrationId) === quitter.id));
      const m2 = theirMatch ? after.find((m) => m.id === theirMatch.id) : null;

      const left = m2 ? (m2.participants || []).length : null;
      noteBuilt(ctx.contestId, 'RUNNING (1 người bỏ cuộc)');
      scSay('<b>Bỏ cuộc giữa giải</b> — ' + quitter.email + ' rút khỏi giải khi đã có ' +
        before.length + ' trận.<br>' +
        'Sau khi huỷ, người đó ' + (stillThere
          ? scBad('vẫn còn trong trận đang chờ') + ' — trận này sẽ treo mãi.'
          : scOk('đã được gỡ khỏi mọi trận chưa đấu') + '.') +
        (m2 ? '<br>Trận của họ giờ ở trạng thái <b>' + m2.status + '</b>, còn <b>' +
          left + '</b> người.' +
          // Trận rỗng không tự kết thúc và cũng không ai đấu được — nó đứng đó
          // chặn giải không sang được vòng sau. Nêu thẳng ra thay vì để lọt.
          (left === 0
            ? ' ' + scBad('Trận rỗng') + ' — không còn ai để đấu mà trận vẫn chưa kết thúc. ' +
              'Kiểm tra xem giải có chốt được vòng này không.'
            : '')
          : '') +
        '<br>Giải ' + ctx.contestId);
    },
  },

  cancelPaid: {
    label: 'Huỷ giải sau khi đã thu phí dự thi',
    run: async () => {
      await runRange(0, STEP.PRELUDE_END);
      resetContest();
      ctx.nameSuffix = 'huy-sau-khi-thu-phi';
      // Kịch bản này chỉ có nghĩa khi CÓ tiền để mà mất. Form đang để 0 thì tự
      // đặt một mức phí, không thì "huỷ giải đã thu phí" thành huỷ giải miễn phí.
      const fee = Number($('cFee').value) > 0 ? Number($('cFee').value) : 50000;
      ctx.overrides = { entry_fee: fee };

      await runRange(STEP.CREATE, STEP.OPEN + 1);
      await runRange(STEP.REGISTER, STEP.REGISTER + 1);

      // Ghi nhận ĐÃ THU TIỀN, không phải miễn phí — khác hẳn bước chuẩn.
      for (const r of ctx.registrations) {
        await call('POST', '/contest-registrations/' + r.id + '/mark-entry-fee-paid',
          { note: 'Đã thu phí dự thi — dựng bằng Contest Lab' }, ctx.providerToken);
      }
      await runRange(STEP.APPROVE, STEP.APPROVE + 1);

      const total = fee * ctx.registrations.length;
      await call('POST', '/contests/' + ctx.contestId + '/cancel', {}, ctx.providerToken);

      const res = await call('GET', '/contests/' + ctx.contestId + '/registrations',
        null, ctx.providerToken);
      const regs = res.data || res;
      // Trạng thái tiền nằm ở payment_status của đăng ký, không phải một trường
      // riêng tên entry_fee_* — đọc sai tên thì báo cáo ra "KHÔNG RÕ" và kịch bản
      // này mất hết ý nghĩa, vì tiền chính là thứ nó theo dõi.
      const counts = {};
      (Array.isArray(regs) ? regs : []).forEach((r) => {
        const paid = r.payment_status || r.paymentStatus || 'KHÔNG RÕ';
        const k = 'tiền ' + paid + ' · đăng ký ' + r.status;
        counts[k] = (counts[k] || 0) + 1;
      });

      noteBuilt(ctx.contestId, 'CANCELLED (đã thu phí)');
      scSay('<b>Huỷ giải sau khi đã thu phí dự thi</b> — ' + ctx.registrations.length +
        ' người đã trả ' + total.toLocaleString('vi-VN') + 'đ, rồi giải bị huỷ.<br>' +
        'Trạng thái phí/đăng ký sau khi huỷ: <b>' +
        Object.keys(counts).map((k) => counts[k] + '× ' + k).join(' · ') + '</b><br>' +
        'Mở giải này trên giao diện và đối chiếu: tiền đã thu có đường về tay khách không?' +
        '<br>Giải ' + ctx.contestId);
    },
  },

  overCapacity: {
    label: 'Đăng ký vượt sức chứa',
    run: async () => {
      const n = $('athletes').value.split('\n').map((s) => s.trim()).filter(Boolean).length;
      if (n < 2) throw new Error('Cần ít nhất 2 vận động viên để thử vượt sức chứa');

      await runRange(0, STEP.PRELUDE_END);
      resetContest();
      ctx.nameSuffix = 'vuot-suc-chua';
      // Sức chứa ít hơn số người đúng một suất: người cuối cùng PHẢI bị chặn.
      ctx.overrides = { capacity: n - 1 };
      ctx.expectCapacity = true;

      await runRange(STEP.CREATE, STEP.OPEN + 1);
      await runRange(STEP.REGISTER, STEP.REGISTER + 1);

      const accepted = ctx.registrations.length;
      const rejected = ctx.capacityRejected.length;
      ctx.expectCapacity = false;

      const pass = accepted === n - 1 && rejected === 1;
      noteBuilt(ctx.contestId, 'OPEN (thử vượt sức chứa)');
      scSay('<b>Đăng ký vượt sức chứa</b> — sức chứa ' + (n - 1) + ', cho ' + n +
        ' người cùng đăng ký.<br>Nhận ' + accepted + ', chặn ' + rejected + '. ' +
        (pass
          ? scOk('ĐẠT') + ' — chốt chặn sức chứa hoạt động, người thứ ' + n +
            ' bị từ chối bằng CONTEST_CAPACITY_REACHED.'
          : scBad('KHÔNG ĐẠT') + ' — nhận đủ ' + accepted + ' người trong khi chỉ có ' +
            (n - 1) + ' suất. Giải nhận quá số người mà không có gì chặn lại.') +
        '<br>Giải ' + ctx.contestId);
    },
  },
};

async function runScenario(key) {
  const sc = SCENARIOS[key];
  scSay('Đang chạy <b>' + sc.label + '</b>…');
  log('dim', '── Kịch bản: ' + sc.label + ' ──');
  try {
    await sc.run();
    saveState();
    log('ok', '── Kịch bản xong ──');
  } catch (e) {
    ctx.expectCapacity = false;
    scSay('<b>' + sc.label + '</b> — ' + scBad('không chạy trọn') + ': ' + e.message);
    log('err', 'Kịch bản hỏng: ' + e.message);
  }
}

// Chi nhánh KHÔNG nằm trong danh mục chung — xem chú thích ở loadMyCafes.
const CATALOG = [
  { sel: 'cType', path: '/contest-catalog/types', label: 'loại giải' },
  { sel: 'cFormat', path: '/contest-catalog/formats', label: 'thể thức' },
  { sel: 'cTemplate', path: '/contest-catalog/templates', label: 'khuôn mẫu' },
];

/**
 * Ô chi nhánh chỉ liệt kê chi nhánh CỦA provider đang đăng nhập.
 *
 * Nạp cả /cafes công khai thì ô hiện chi nhánh của mọi provider trên hệ thống.
 * Chọn nhầm một cái không thuộc mình, bước tạo giải bị từ chối bằng một lỗi
 * không nhắc gì tới quyền sở hữu — người dùng chọn đúng thứ trang đưa ra mà vẫn
 * sai, và không có cách nào đoán ra tại sao.
 *
 * Vì vậy trước khi đăng nhập provider, ô này để trống có chủ đích.
 */
async function loadMyCafes() {
  const st = $('provStatus');
  if (!ctx.providerToken || !ctx.providerId) {
    fillSelect('cCafe', [], 'name');
    st.textContent = 'Chưa đăng nhập — ô chi nhánh ở mục 2 còn trống.';
    return [];
  }

  let res;
  try {
    res = await call('GET', '/cafes?limit=50', null, ctx.providerToken);
  } catch (e) {
    // Token khôi phục từ phiên trước có thể đã hết hạn — JWT sống 1 giờ. Không
    // dọn ở đây thì mọi bước sau ăn 401 và trông như hệ thống hỏng, chứ không
    // như phiên đã hết hạn.
    ctx.providerToken = null; ctx.providerId = null;
    fillSelect('cCafe', [], 'name');
    st.textContent = 'Phiên đăng nhập trước đã hết hạn — bấm nút trên để đăng nhập lại.';
    return [];
  }
  const rows = res.data || res;
  // Danh sách chi nhánh trả về camelCase, khác hầu hết endpoint khác dùng
  // snake_case — nhận cả hai để không phụ thuộc vào một kiểu đặt tên.
  const owned = rows.filter((c) => (c.providerId || c.provider_id) === ctx.providerId);
  fillSelect('cCafe', owned, 'name');
  ctx.cafeId = $('cCafe').value || null;
  await loadTrackTypesForCafe();
  st.textContent = owned.length
    ? 'Provider ' + ctx.providerId.slice(0, 8) + '… — ô chi nhánh đang lọc còn ' +
      owned.length + ' chi nhánh của riêng tài khoản này.'
    : 'Provider này chưa có chi nhánh nào. Bước 3 sẽ tự tạo một cái khi bạn chạy.';
  return owned;
}

// Nạp từng ô ĐỘC LẬP. Gộp vào một Promise.all thì chỉ cần một endpoint hỏng là
// không ô nào được đổ dữ liệu, và người dùng nhìn thấy năm ô rỗng trơ mà không
// biết cái nào hỏng.
/**
 * Loại sân phải lấy theo CHI NHÁNH đang chọn, không phải danh sách toàn hệ thống.
 *
 * Khi tạo giải, hệ thống kiểm bảng cafe_track_configs đang bật của đúng chi nhánh
 * đó. Một loại sân có trong danh mục chung nhưng chi nhánh đã tắt thì vẫn hiện
 * ra ở ô chọn mà tạo giải lại bị từ chối với CONTEST_TRACK_TYPE_UNAVAILABLE —
 * người dùng chọn đúng thứ được đưa ra mà vẫn sai.
 */
async function loadTrackTypesForCafe() {
  const cafeId = $('cCafe').value;
  const st = $('trackStatus');
  if (!cafeId) { fillSelect('cTrack', [], 'name'); return; }
  try {
    const res = await call('GET', '/cafes/' + cafeId + '/track-configs');
    const rows = (Array.isArray(res) ? res : res.data || []).filter((r) => r.is_active !== false);
    fillSelect('cTrack', rows.map((r) => ({
      id: r.track_type_id,
      name: (r.track_type && r.track_type.name) || r.track_type_id,
    })), 'name');
    st.textContent = rows.length
      ? 'Chi nhánh này đang bật ' + rows.length + ' loại sân.'
      : 'Chi nhánh này chưa bật loại sân nào — chọn chi nhánh khác.';
  } catch (e) {
    fillSelect('cTrack', [], 'name');
    st.textContent = 'Không đọc được loại sân của chi nhánh: ' + e.message;
  }
}

// ── Chọn vận động viên từ tài khoản có sẵn ───────────────────────────────────
// Gõ tay từng email thì tới người thứ mười đã hết kiên nhẫn, mà giải thật cần
// mười sáu hoặc ba hai. Bảng chọn đọc thẳng danh sách khách trong hệ thống.

/**
 * Khoá mở trang, lấy lại từ địa chỉ đang mở.
 *
 * Endpoint /dev-tools/customers nằm sau chính hàng rào khoá như trang này. Gọi
 * mà quên kèm khoá thì nhận 404 — trông y hệt "endpoint không tồn tại", và
 * người sửa sẽ đi tìm lỗi ở chỗ hoàn toàn khác.
 */
const DEV_KEY = new URLSearchParams(location.search).get('key');

function devPath(p) {
  if (!DEV_KEY) return p;
  return p + (p.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(DEV_KEY);
}

/** Gọi endpoint ngoài /api/v1 — dev-tools nằm ở gốc, không nằm dưới tiền tố API. */
async function callDev(path, token) {
  log('req', 'GET ' + path);
  const res = await fetch(location.origin + devPath(path), {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || ('HTTP ' + res.status);
    log('err', '  ✗ ' + res.status + ' ' + msg);
    throw new Error(msg);
  }
  log('ok', '  ✓ ' + res.status + '  ' + short(json && json.data !== undefined ? json.data : json));
  return json && json.data !== undefined ? json.data : json;
}

/** Ghi lựa chọn xuống ô nhập — ô đó vẫn là nguồn duy nhất các bước đọc. */
function syncPicked() {
  const picked = ctx.picked || [];
  if (picked.length) $('athletes').value = picked.join('\n');
  const n = picked.length;
  const pow2 = n >= 2 && (n & (n - 1)) === 0;
  $('pickStatus').innerHTML = n
    ? 'Đã chọn <b>' + n + '</b> người. ' + (pow2
        ? scOk('Là luỹ thừa của 2') + ' — bảng nhánh loại trực tiếp tròn vòng.'
        : 'Không phải luỹ thừa của 2 — thể thức loại trực tiếp sẽ có suất trống. ' +
          'Không sao với đua tính giờ hay vòng tròn.')
    : 'Chưa chọn ai — công cụ dùng những gì đang có trong ô bên dưới.';
  saveState();
}

function renderCustomers() {
  const box = $('custList');
  const term = $('custSearch').value.trim().toLowerCase();
  const rows = (ctx.customers || []).filter((c) =>
    !term || c.email.toLowerCase().indexOf(term) >= 0 ||
    (c.full_name || '').toLowerCase().indexOf(term) >= 0);

  if (!rows.length) {
    box.innerHTML = (ctx.customers || []).length
      ? 'Không có ai khớp "' + term + '".'
      : 'Chưa nạp danh sách.';
    return;
  }

  const picked = new Set(ctx.picked || []);
  box.innerHTML = '';
  rows.forEach((c) => {
    const lb = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = picked.has(c.email);
    cb.onchange = () => {
      const set = new Set(ctx.picked || []);
      if (cb.checked) set.add(c.email); else set.delete(c.email);
      ctx.picked = Array.from(set);
      syncPicked();
    };
    const em = document.createElement('span');
    em.className = 'em'; em.textContent = c.email;
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = c.full_name || '';
    lb.appendChild(cb); lb.appendChild(em); lb.appendChild(nm);
    box.appendChild(lb);
  });
}

/** Những người đang hiện sau bộ lọc — mọi nút chọn hàng loạt đều tính trên tập này. */
function visibleCustomers() {
  const term = $('custSearch').value.trim().toLowerCase();
  return (ctx.customers || []).filter((c) =>
    !term || c.email.toLowerCase().indexOf(term) >= 0 ||
    (c.full_name || '').toLowerCase().indexOf(term) >= 0);
}

async function loadCustomers() {
  const box = $('custList');
  box.textContent = 'Đang nạp…';
  // Danh sách khách chỉ admin đọc được. Đăng nhập ngay tại đây thay vì bắt chạy
  // bước 1 trước — người dùng bấm nút này lúc còn đang điền form.
  if (!ctx.adminToken) {
    const a = await login($('aEmail').value, $('aPwd').value);
    ctx.adminToken = a.token;
  }
  ctx.customers = await callDev('/dev-tools/customers?limit=500', ctx.adminToken);
  ctx.picked = ctx.picked || [];
  renderCustomers();
  log('ok', 'Đã nạp ' + ctx.customers.length + ' tài khoản khách.');
}

async function loadCatalog() {
  const flat = (x) => (Array.isArray(x) ? x : (x && x.data) || []);
  const results = await Promise.allSettled(CATALOG.map((c) => call('GET', c.path)));
  const ok = [];
  const bad = [];
  results.forEach((r, i) => {
    const c = CATALOG[i];
    if (r.status === 'fulfilled') {
      const rows = flat(r.value);
      fillSelect(c.sel, rows, 'name');
      ok.push(rows.length + ' ' + c.label);
    } else {
      fillSelect(c.sel, [], 'name');
      bad.push(c.label + ' (' + r.reason.message + ')');
    }
  });
  const st = $('catStatus');
  st.textContent = bad.length
    ? 'Nạp thiếu — hỏng: ' + bad.join('; ')
    : 'Đã nạp: ' + ok.join(' · ');
  // Chi nhánh phụ thuộc vào việc đã đăng nhập provider hay chưa, nên nạp riêng.
  await loadMyCafes();
  if (bad.length) throw new Error(bad.join('; '));
}

$('btnLoad').onclick = async () => {
  try {
    await loadCatalog();
    log('ok', 'Đã nạp lại danh mục.');
  } catch (e) { log('err', 'Nạp danh mục hỏng: ' + e.message); }
};

document.querySelectorAll('[data-goto]').forEach((b) => {
  b.onclick = () => runTo(Number(b.dataset.goto));
});

// Đăng nhập provider riêng, không chờ tới lúc chạy bước 1 — có token rồi thì ô
// chi nhánh mới lọc được về đúng chi nhánh của người đang dùng.
$('btnProviderCafes').onclick = async () => {
  const st = $('provStatus');
  st.textContent = 'Đang đăng nhập…';
  try {
    const p = await login($('pEmail').value, $('pPwd').value);
    ctx.providerToken = p.token;
    ctx.providerId = p.user.id;
    await loadMyCafes();
    saveState();
  } catch (e) {
    ctx.providerToken = null; ctx.providerId = null;
    fillSelect('cCafe', [], 'name');
    st.textContent = 'Không đăng nhập được: ' + e.message;
    log('err', e.message);
  }
};

$('btnBatch').onclick = () => runBatch();

// ── Nút của bảng chọn vận động viên ──────────────────────────────────────────
$('btnLoadCustomers').onclick = async () => {
  try { await loadCustomers(); } catch (e) {
    $('custList').textContent = 'Không nạp được: ' + e.message;
    log('err', e.message);
  }
};

$('custSearch').oninput = () => renderCustomers();

$('btnPickAll').onclick = () => {
  const set = new Set(ctx.picked || []);
  visibleCustomers().forEach((c) => set.add(c.email));
  ctx.picked = Array.from(set);
  renderCustomers(); syncPicked();
};

$('btnPickNone').onclick = () => {
  ctx.picked = [];
  renderCustomers(); syncPicked();
};

$('btnPickRandom').onclick = () => {
  const pool = visibleCustomers().slice();
  const want = Math.min(Number($('pickN').value) || 0, pool.length);
  if (!pool.length) { log('err', 'Chưa nạp danh sách tài khoản.'); return; }
  // Xáo Fisher–Yates rồi cắt: lấy ngẫu nhiên kiểu "bốc rồi loại" mới cho mỗi
  // người đúng một suất. Bốc có hoàn lại thì danh sách trùng tên, và bước đăng
  // ký sẽ chết vì một người đăng ký hai lần.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  ctx.picked = pool.slice(0, want).map((c) => c.email);
  renderCustomers(); syncPicked();
  log('dim', 'Đã lấy ngẫu nhiên ' + ctx.picked.length + '/' + visibleCustomers().length + ' người.');
};

document.querySelectorAll('[data-scenario]').forEach((b) => {
  b.onclick = () => runScenario(b.dataset.scenario);
});

$('btnCancel').onclick = async () => {
  if (!ctx.contestId) { log('err', 'Chưa tạo giải nào trong phiên này.'); return; }
  try {
    await call('POST', '/contests/' + ctx.contestId + '/cancel', {}, ctx.providerToken);
    log('ok', 'Đã huỷ giải ' + ctx.contestId);
  } catch (e) { log('err', e.message); }
};

$('btnReset').onclick = () => {
  resetContest();
  renderSteps(); showCtx(); showResume(); saveState();
  log('dim', 'Đã xoá trạng thái phiên. Dữ liệu đã tạo vẫn còn trong cơ sở dữ liệu.');
};

$('cCafe').onchange = () => loadTrackTypesForCafe();

$('btnClear').onclick = () => { logBox.innerHTML = '<span class="l-dim">Đã xoá.</span>'; };
$('btnCopy').onclick = () => navigator.clipboard.writeText(logBox.innerText);

// ── Nhớ trạng thái qua F5 ────────────────────────────────────────────────────
// Không có phần này thì mỗi lần tải lại trang là mất sạch: phải điền lại form và
// tạo một giải mới, trong khi giải cũ vẫn nằm đó dang dở.
const SAVE_KEY = 'rcfield-contest-lab';
const FORM_IDS = ['pMode', 'pEmail', 'pPwd', 'aEmail', 'aPwd', 'athPwd', 'athletes',
  'cName', 'cCap', 'cType', 'cFormat', 'cTemplate', 'cCafe', 'cTrack', 'cPolicy',
  'cFee', 'cDays', 'byocPhoto',
  'bDraft', 'bOpen', 'bApproved', 'bClosed', 'bRunning', 'bCompleted', 'bCancelled'];

function saveState() {
  const form = {};
  FORM_IDS.forEach((id) => { const el = $(id); if (el) form[id] = el.value; });
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ form, ctx }));
  } catch (e) { /* hết chỗ lưu thì thôi, không đáng để chặn công cụ */ }
}

function readState() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
}

function showResume() {
  const box = $('resumePanel');
  if (!ctx.contestId) { box.style.display = 'none'; return; }
  box.style.display = '';
  const bits = ['giải ' + ctx.contestId];
  if (ctx.registrations.length) bits.push(ctx.registrations.length + ' đăng ký');
  if (ctx.matches.length) bits.push(ctx.matches.length + ' trận');
  $('resumeInfo').textContent = bits.join('  ·  ');
}

FORM_IDS.forEach((id) => {
  const el = $(id);
  if (el) { el.addEventListener('change', saveState); el.addEventListener('input', saveState); }
});

$('btnRefreshContest').onclick = async () => {
  try {
    const c = await call('GET', '/contests/' + ctx.contestId, null, ctx.providerToken);
    log('ok', 'Giải đang ở trạng thái ' + c.status);
  } catch (e) { log('err', e.message); }
};

$('btnNewContest').onclick = () => {
  resetContest();
  saveState(); showResume(); renderSteps();
  log('dim', 'Đã bỏ giải cũ khỏi phiên. Lần chạy tới sẽ tạo giải mới.');
};

renderSteps();

// Năm danh mục dưới đây đều là endpoint công khai, không cần đăng nhập — nạp
// ngay lúc mở trang để các ô chọn không bị rỗng.
log('dim', 'Trang tải lúc ' + new Date().toLocaleTimeString('vi-VN') + ' · API ' + API);

const saved = readState();
if (saved) {
  // Ô nhập chữ khôi phục ngay; ô chọn phải chờ có dữ liệu mới gán được, nếu
  // không giá trị cũ bị bỏ vì lúc đó chưa có lựa chọn nào khớp.
  FORM_IDS.forEach((id) => {
    const el = $(id);
    if (el && saved.form && saved.form[id] !== undefined && el.tagName !== 'SELECT') {
      el.value = saved.form[id];
    }
  });
  Object.assign(ctx, saved.ctx || {});
  ctx.registrations = ctx.registrations || [];
  ctx.matches = ctx.matches || [];
  ctx.athletes = ctx.athletes || [];
  ctx.built = ctx.built || [];
  ctx.picked = ctx.picked || [];
  // Danh sách tài khoản KHÔNG khôi phục — nó là ảnh chụp của cơ sở dữ liệu và
  // sẽ cũ đi. Lựa chọn thì giữ, vì đã nằm sẵn trong ô nhập rồi.
  ctx.customers = [];
  renderBuilt();
  if (ctx.picked.length) syncPicked();
  showResume();
  if (ctx.contestId) log('dim', 'Khôi phục phiên trước — giải ' + ctx.contestId);
}

loadCatalog()
  .then(() => {
    if (saved && saved.form) {
      ['cType', 'cFormat', 'cTemplate', 'cCafe', 'cPolicy'].forEach((id) => {
        if (saved.form[id]) $(id).value = saved.form[id];
      });
      return loadTrackTypesForCafe().then(() => {
        if (saved.form.cTrack) $('cTrack').value = saved.form.cTrack;
      });
    }
  })
  .then(() => log('dim', 'Đã nạp danh mục. Sửa thông tin giải rồi bấm một nút ở mục 3.'))
  .catch((e) => log('err', 'Nạp danh mục thiếu: ' + e.message));
`;
