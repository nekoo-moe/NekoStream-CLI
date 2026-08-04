<div align="center">

# 🐱 NekoStream CLI

**Tìm, duyệt và xem anime Việt — ngay trong terminal.**

[![npm](https://img.shields.io/npm/v/nekostream?color=8b5cf6&label=npm&logo=npm)](https://www.npmjs.com/package/nekostream)
[![node](https://img.shields.io/badge/node-%E2%89%A522.12-3c873a?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![case study](https://img.shields.io/badge/case%20study-c%C3%B4ng%20khai-f59e0b)](CODE_ASSESSMENT.md)

```
  ╭──────────────────────────────────────────╮
  │  ❯ nekostream                            │
  │                                          │
  │    ▸ Tìm anime                           │
  │      Thịnh hành          Mới cập nhật    │
  │      Lịch sử xem         Tài khoản       │
  │      Cài đặt                             │
  ╰──────────────────────────────────────────╯
```

</div>

---

## Dự án này là gì

Hai thứ, và cả hai đều thật:

**Một** — một CLI dùng được hằng ngày để xem anime từ các provider Việt Nam: không cần mở trình duyệt, không quảng cáo, không server trung gian.

**Hai** — một **case study công khai về chất lượng code**. Đây là codebase tự học, viết bởi một người, tiến hoá qua ba tháng từ "chạy được" đến "chịu được review". Toàn bộ quá trình đó — kể cả những chỗ sai — được ghi lại nguyên trạng, kèm số dòng, trong hai tài liệu:

| Tài liệu | Nội dung |
| --- | --- |
| 📊 [CODE_ASSESSMENT.md](CODE_ASSESSMENT.md) | Đánh giá thẳng thắn toàn bộ codebase: bảng điểm, nợ kỹ thuật, lỗ bảo mật, và **7 bài học** rút từ chính repo này |
| 🗺️ [CLEANUP_PLAN.md](CLEANUP_PLAN.md) | Kế hoạch refactor theo phase — phase nào xong, phase nào còn, và vì sao theo thứ tự đó |

Nếu bạn đang học TypeScript/Node và muốn xem một dự án thật *trước và sau* khi được dọn — thay vì một repo đã sạch sẵn, không cho biết đường đi tới đó — hãy đọc hai file trên.

---

## Cài đặt

```bash
npm install -g nekostream
nekostream
```

Yêu cầu: **Node.js ≥ 22.12**, terminal hỗ trợ màu ANSI (Windows / macOS / Linux).

<details>
<summary><b>Cập nhật &amp; kiểm tra phiên bản</b></summary>

```bash
npm view nekostream version        # phiên bản mới nhất trên npm
npm install -g nekostream@latest   # cập nhật
```

</details>

---

## Tính năng

| | |
| --- | --- |
| 🔍 **Tìm &amp; duyệt** | Tìm theo tên, xem danh sách thịnh hành và mới cập nhật |
| 🎬 **Trình phát tích hợp** | Electron + ArtPlayer, chặn quảng cáo và popup của provider |
| 🌐 **Đa provider** | AnimeVietsub, Anime47 — kèm AnimeHay ở chế độ *duy trì, không đầu tư thêm* |
| 📚 **Lịch sử xem** | Lưu local, tiếp tục xem nhanh, giữ 100 mục gần nhất |
| 👤 **Đăng nhập provider** | Truy cập danh sách cá nhân; session mã hoá AES-256-GCM tại chỗ |
| 🔗 **Metadata AniList** | Bổ sung mô tả, thể loại, điểm — không bắt buộc, lỗi không làm hỏng luồng |
| 🎮 **Discord Rich Presence** | Bật/tắt trong Cài đặt |
| ⚙️ **Domain tuỳ chỉnh** | Đổi domain provider khi domain mặc định bị chặn |

---

## Kiến trúc

```
nekostream
├── cli/                     Tầng giao diện — menu, flow, theme, feedback
│   ├── menus/               Mỗi menu là một module độc lập
│   └── flows/               Luồng nghiệp vụ: tìm, xem, đăng nhập
├── scrapers/                Tầng dữ liệu
│   ├── providers/           animevietsub · anime47 · animehay
│   ├── anilist-api.ts       Metadata (có rate limiting)
│   └── auth-service.ts      Đăng nhập & session
├── provider-types.ts        Discriminated union — nguồn sự thật về provider
├── storage.ts               Settings · history · auth session (mã hoá)
├── player-main.js           Electron main process
├── webview-preload.js       Preload cho <webview> phát video
└── checks/                  Test offline chạy trên HTML fixture đã commit
```

Bốn nguyên tắc đang được áp dụng dần, ghi rõ trong [CLEANUP_PLAN.md](CLEANUP_PLAN.md):

- **Không có string tự do ở biên module.** Provider, action, menu đều là union type — thêm provider mới thì compiler chỉ ra mọi chỗ phải sửa, thay vì phát hiện lúc runtime.
- **Lỗi trả về, không throw xuyên tầng.** `withSilentSpinner` trả `{ ok: true, value } | { ok: false, error }`, buộc caller xử lý nhánh lỗi.
- **Comment ghi *tại sao*, không mô tả cú pháp.** Comment lý tưởng là một bug đã xảy ra, được ghi lại để người sau không xoá mất phần sửa.
- **Test chạy offline và đã được chứng minh có thể fail.** [checks/parser-check.mts](checks/parser-check.mts) chặn cứng `globalThis.fetch`; fixture được kiểm tra bằng mutation check. Chính bộ test này đã tìm ra một bug production trong ngày nó được viết.

---

## Bảo mật

Tầng Electron từng là phần yếu nhất của dự án — [CODE_ASSESSMENT.md](CODE_ASSESSMENT.md) cho điểm **2/10** và liệt kê ba lỗi mức *chặn phát hành*. Cả ba đã được xử lý:

| Vấn đề | Trước | Sau |
| --- | --- | --- |
| **Eruda console** | Tải từ CDN công khai vào mọi lần phát, trong ngữ cảnh có Node | Chỉ bật khi `debugMode`, đọc từ `node_modules` — **không request mạng** |
| **Mã hoá session** | AES-256-CBC không auth tag, kèm đường hạ cấp `plain:` cho phép ghi plaintext | AES-256-GCM có auth tag; `plain:` bị **loại bỏ**; file mode `0600` |
| **Kiểm tra host** | `url.includes('anime47')` — mọi URL chứa chuỗi đó đều nhận Bearer token của người dùng | Allowlist theo **hostname đã parse**, so khớp registrable label |
| **DOM dump** | Ghi vô điều kiện vào thư mục package đã cài | Chỉ khi debug, ghi vào `~/.nekostream-cli/` |
| **CSP / X-Frame-Options** | Strip cho `*://*/*` | Chỉ strip trên host provider và host phát video |
| **IPC** | Nhận mọi sender | Xác thực `event.sender`; payload stream được validate schema |

Phần còn lại — `contextIsolation: false` ở renderer chính — được ghi nhận công khai và xếp vào Phase 6, **chưa xử lý**. Dự án không giả vờ rằng nó đã xong.

Ba file Electron trước đây **bị loại khỏi linter** để CI xanh. Đó chính là bài học số 1 trong case study, và `ignores` đó đã được xoá — cả ba file hiện nằm trong `npm run lint`.

---

## Phát triển

```bash
npm install
npm start          # chạy bản dev
npm run check      # lint → typecheck → test → build → pack:check
```

`npm run check` là cổng duy nhất. Mọi thay đổi phải qua nó trước khi commit.

<details>
<summary><b>Gỡ lỗi</b></summary>

CLI ẩn log scraper để terminal sạch. Bật khi cần:

```bash
NEKOSTREAM_DEBUG=1 nekostream                      # bash / zsh
$env:NEKOSTREAM_DEBUG="1"; nekostream              # PowerShell
```

Debug của **trình phát** (DOM dump, Eruda console) bật riêng qua `debugMode` trong menu Cài đặt — không đọc từ biến môi trường của shell, để một biến sót lại không thể tự mở công cụ debug bên trong trang phát.

</details>

<details>
<summary><b>Cập nhật fixture test</b></summary>

Fixture là snapshot HTML thật của provider. Khi provider đổi markup:

```bash
npx tsx checks/capture-fixtures.mts
```

Tool này **không** nằm trong `npm test`: nó cần mạng, còn test thì phải offline và deterministic.

</details>

---

## Đóng góp

Repo này hoan nghênh cả hai loại đóng góp:

- **Code** — đọc [CLEANUP_PLAN.md](CLEANUP_PLAN.md) trước; các phase còn lại đã mô tả kèm thứ tự và lý do. PR nhỏ, một scope, giữ `npm run check` xanh.
- **Phản biện đánh giá** — nếu bạn cho rằng [CODE_ASSESSMENT.md](CODE_ASSESSMENT.md) chấm sai hoặc bỏ sót một vấn đề, hãy mở issue. Một case study bị phản biện có giá trị hơn một case study được đồng thuận.

---

## Miễn trừ trách nhiệm

- Dự án **không** lưu trữ, phát tán hoặc sở hữu bất kỳ nội dung video nào.
- NekoStream CLI là client kết nối trực tiếp từ máy người dùng đến provider — **không có server trung gian**.
- Dự án không thu thập dữ liệu cá nhân. Toàn bộ lịch sử và session nằm trong `~/.nekostream-cli/` trên máy bạn.
- Vui lòng sử dụng có trách nhiệm và tuân thủ điều khoản của từng provider.

<div align="center">

**[Case study →](CODE_ASSESSMENT.md)** · **[Roadmap →](CLEANUP_PLAN.md)** · **[npm →](https://www.npmjs.com/package/nekostream)**

</div>
