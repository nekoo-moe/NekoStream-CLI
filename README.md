<div align="center">

# 🐱 NekoStream CLI

**Tìm, duyệt và xem anime Việt — ngay trong terminal.**

[![npm](https://img.shields.io/npm/v/nekostream?color=8b5cf6&label=npm&logo=npm)](https://www.npmjs.com/package/nekostream)
[![node](https://img.shields.io/badge/node-%E2%89%A522.12-3c873a?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)

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

một CLI dùng được hằng ngày để xem anime từ các provider Việt Nam: không cần mở trình duyệt, không quảng cáo, không server trung gian.

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
``
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

</div>
