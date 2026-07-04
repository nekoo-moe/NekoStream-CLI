# NekoStream CLI

NekoStream CLI là ứng dụng dòng lệnh để tìm, duyệt và xem anime từ nhiều provider phổ biến tại Việt Nam. Ứng dụng tập trung vào trải nghiệm terminal gọn, nhanh, hỗ trợ lịch sử xem, tài khoản provider và trình phát video tích hợp.

## Cài đặt

Yêu cầu:

- Node.js 18 trở lên
- Windows, macOS hoặc Linux có terminal hỗ trợ màu ANSI

Cài đặt toàn cục từ npm:

```bash
npm install -g nekostream
```

Chạy ứng dụng:

```bash
nekostream
```

Kiểm tra phiên bản mới nhất trên npm:

```bash
npm view nekostream version
```

Cập nhật lên bản mới nhất:

```bash
npm install -g nekostream@latest
```

## Tính năng chính

- Tìm anime, xem danh sách thịnh hành và danh sách mới cập nhật.
- Hỗ trợ nhiều provider: AnimeVietsub, Anime47, AnimeHay.
- Hiển thị thông tin phim, thể loại, số tập, trạng thái và mô tả.
- Lưu lịch sử xem local để tiếp tục xem nhanh.
- Hỗ trợ đăng nhập provider cho các danh sách cá nhân khi provider hỗ trợ.
- Tùy chỉnh domain provider khi domain mặc định bị chặn.
- Trình phát video tích hợp bằng Electron/ArtPlayer.
- Discord Rich Presence có thể bật/tắt trong cài đặt.

## Lệnh phát triển

Cài dependencies:

```bash
npm install
```

Chạy bản development:

```bash
npm start
```

Build TypeScript:

```bash
npm run build
```

Trước khi publish, hãy đảm bảo `version` trong `package.json` và `package-lock.json` đã khớp nhau.

## Gỡ lỗi

Mặc định CLI ẩn log scraper/debug để giao diện terminal sạch hơn.

Bật debug log khi cần kiểm tra provider hoặc AniList:

```bash
NEKOSTREAM_DEBUG=1 nekostream
```

Trên Windows PowerShell:

```powershell
$env:NEKOSTREAM_DEBUG="1"; nekostream
```

## Miễn trừ trách nhiệm

- Dự án không lưu trữ, phát tán hoặc sở hữu nội dung video.
- NekoStream CLI chỉ là client kết nối trực tiếp từ máy người dùng đến provider.
- Dự án không thu thập dữ liệu cá nhân và không sử dụng máy chủ trung gian.
- Vui lòng sử dụng có trách nhiệm và tuân thủ điều khoản của từng provider.
