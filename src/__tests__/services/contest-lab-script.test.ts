import vm from 'vm';
import { CLIENT_SCRIPT } from '../../dev-tools/contest-lab.template';

/**
 * Nạp phần JS của Contest Lab vào một DOM giả để soi được vào bên trong.
 *
 * Chạy lô và các kịch bản lệch đường đều nhảy thẳng vào giữa chuỗi 17 bước bằng
 * chỉ số. Chèn thêm một bước ở giữa là mọi chỉ số phía sau lệch đi một, và
 * KHÔNG có gì báo: công cụ vẫn chạy, chỉ là "dừng ở RUNNING" lại dừng ở chỗ
 * khác. Test này neo chỉ số vào TÊN bước, nên lệch là đỏ ngay.
 */
function loadScript() {
  const el = () => ({
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    classList: { contains: () => false },
    appendChild() {},
    querySelector: () => ({ textContent: '' }),
    addEventListener() {},
    scrollTop: 0,
    scrollHeight: 0,
    firstChild: null,
  });

  const sandbox = {
    location: { origin: 'http://localhost:3000', search: '?key=abc' },
    URLSearchParams,
    document: {
      getElementById: () => el(),
      createElement: () => el(),
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { clipboard: { writeText() {} } },
    // Không cho gọi mạng thật: mọi lời gọi trả về lỗi, phần khởi động đã bắt sẵn.
    fetch: () => Promise.reject(new Error('offline')),
    console,
    setTimeout,
  };
  vm.createContext(sandbox);
  // Trả STEPS/STEP ra ngoài — cả hai là const ở phạm vi cao nhất của script.
  new vm.Script(
    CLIENT_SCRIPT + '\n;globalThis.__probe = { STEPS, STEP, SCENARIOS, BATCH, devPath };',
  ).runInContext(sandbox);
  return (sandbox as unknown as { __probe: Probe }).__probe;
}

interface Probe {
  STEPS: Array<{ name: string; api: string; run: () => Promise<string> }>;
  STEP: Record<string, number>;
  SCENARIOS: Record<string, { label: string; run: () => Promise<void> }>;
  BATCH: Array<{ input: string; label: string; to: number; cancel?: boolean }>;
  devPath: (p: string) => string;
}

describe('phần JS của Contest Lab', () => {
  const probe = loadScript();

  it('có đủ 17 bước, mỗi bước đều nêu rõ endpoint nó gọi', () => {
    expect(probe.STEPS).toHaveLength(17);
    probe.STEPS.forEach((s) => {
      expect(typeof s.name).toBe('string');
      expect(s.api.length).toBeGreaterThan(0);
      expect(typeof s.run).toBe('function');
    });
  });

  /**
   * Neo từng chỉ số vào một mẩu tên đặc trưng của bước đó. Đổi tên bước thì test
   * đỏ và người sửa phải nhìn lại chỉ số — đó chính là điều cần xảy ra.
   */
  it('chỉ số bước trỏ đúng bước nó nói', () => {
    const at = (i: number) => probe.STEPS[i].name.toLowerCase();
    expect(at(probe.STEP.CREATE)).toContain('tạo giải');
    expect(at(probe.STEP.FEE_ORDER)).toContain('gói tổ chức');
    expect(at(probe.STEP.FEE_TRANSFER)).toContain('chuyển khoản');
    expect(at(probe.STEP.FEE_CONFIRM)).toContain('xác nhận');
    expect(at(probe.STEP.OPEN)).toContain('mở đăng ký');
    expect(at(probe.STEP.REGISTER)).toContain('đăng ký');
    expect(at(probe.STEP.ENTRY_FEE)).toContain('phí dự thi');
    expect(at(probe.STEP.APPROVE)).toContain('duyệt đăng ký');
    expect(at(probe.STEP.CLOSE)).toContain('đóng đăng ký');
    expect(at(probe.STEP.CHECKIN)).toContain('điểm danh');
    expect(at(probe.STEP.GENERATE)).toContain('sinh trận');
    expect(at(probe.STEP.RESULTS)).toContain('kết quả');
    expect(at(probe.STEP.PUBLISH)).toContain('xếp hạng');
  });

  it('phần chuẩn bị dừng ngay trước bước tạo giải', () => {
    // Chạy lô chạy phần chuẩn bị đúng MỘT lần rồi mới lặp phần dựng giải. Hai
    // mốc này rời nhau là hoặc tạo lại provider mỗi vòng, hoặc bỏ qua chuẩn bị.
    expect(probe.STEP.PRELUDE_END).toBe(probe.STEP.CREATE);
  });

  it('mọi mục chạy lô dừng trong phạm vi bộ bước', () => {
    expect(probe.BATCH.length).toBeGreaterThan(0);
    probe.BATCH.forEach((b) => {
      expect(b.to).toBeGreaterThan(probe.STEP.CREATE);
      expect(b.to).toBeLessThanOrEqual(probe.STEPS.length);
    });
    // COMPLETED phải chạy trọn bộ, nếu không giải dừng ở RUNNING mà vẫn dán
    // nhãn COMPLETED — sai lệch chỉ lộ ra khi mở giao diện lên xem.
    const completed = probe.BATCH.find((b) => b.label === 'COMPLETED');
    expect(completed?.to).toBe(probe.STEPS.length);
    // CANCELLED phải thật sự gọi huỷ, không thì nó chỉ là một giải OPEN.
    expect(probe.BATCH.find((b) => b.label === 'CANCELLED')?.cancel).toBe(true);
  });

  it('lời gọi dev-tools mang theo khoá mở trang', () => {
    // Endpoint /dev-tools/customers nằm sau chính hàng rào khoá như trang này.
    // Quên kèm khoá thì nhận 404 — trông y hệt "endpoint không tồn tại", và
    // người sửa đi tìm lỗi ở chỗ hoàn toàn khác.
    expect(probe.devPath('/dev-tools/customers')).toBe('/dev-tools/customers?key=abc');
    // Đã có dấu hỏi rồi thì nối bằng &, không thì khoá đè lên tham số cũ.
    expect(probe.devPath('/dev-tools/customers?limit=500')).toBe(
      '/dev-tools/customers?limit=500&key=abc',
    );
  });

  it('bốn kịch bản lệch đường đều có nhãn và hàm chạy', () => {
    expect(Object.keys(probe.SCENARIOS).sort()).toEqual([
      'cancelPaid',
      'noshow',
      'overCapacity',
      'withdraw',
    ]);
    Object.values(probe.SCENARIOS).forEach((s) => {
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.run).toBe('function');
    });
  });
});
