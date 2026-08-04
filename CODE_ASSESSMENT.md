# NekoStream CLI — Đánh giá chất lượng codebase

**Dạng tài liệu:** study case công khai, phục vụ cộng đồng.
**Ngày đánh giá:** 2026-08-04 · commit `0bdecc3` (main, 71 commits) · 11.528 dòng TS/JS.
**Phạm vi:** toàn bộ source được Git theo dõi, từ code viết đầu tiên (2026-05) đến code viết trong các phase refactor gần nhất (2026-07/08).
**Phương pháp:** đọc trực tiếp từng file, đo bằng `grep`/`wc`/`git log`, không suy đoán. Không chỉnh sửa code trong quá trình đánh giá.

Tài liệu này cố tình không lịch sự hoá. Mục đích của một study case là cho người khác thấy **vì sao** một codebase tự học lại tiến hoá theo hình dạng như vậy — cả phần làm tốt lẫn phần sai — nên các đoạn code được dẫn nguyên trạng kèm số dòng.

---

## 1. Kết luận ngắn

Đây là một codebase **hai tầng chất lượng rõ rệt**, và ranh giới giữa hai tầng gần như trùng khớp với trục thời gian.

| Tầng | Gồm những gì | Đặc trưng |
| --- | --- | --- |
| **Tầng mới** (Phase 0–2.5, tháng 7–8) | [cli/](cli/), [provider-types.ts](provider-types.ts), [checks/](checks/), tooling | Typed, có test, comment giải thích *tại sao*, module nhỏ |
| **Tầng cũ** (tháng 5–6) | [player-main.js](player-main.js), [webview-preload.js](webview-preload.js), [storage.ts](storage.ts), [prompts-wrapper.ts](prompts-wrapper.ts), [scrapers/](scrapers/) | God class, `any`, catch rỗng, logic trùng lặp, toàn bộ rủi ro bảo mật |

Vấn đề nghiêm trọng nhất **không phải** là tầng cũ tồn tại — điều đó bình thường. Vấn đề là **quality gate được cấu hình để miễn trừ đúng những file rủi ro nhất**. `npm run check` xanh không có nghĩa là code an toàn; nó có nghĩa là code đã tránh được các file mà linter được yêu cầu bỏ qua.

Điểm tổng: **tầng mới 8/10, tầng cũ 4/10, quality gate 5/10** — chi tiết ở §7.

---

## 2. Tầng mới: những gì codebase này làm đúng

Cần nói phần này trước, vì đây là phần đáng học nhất.

### 2.1. Comment giải thích nguyên nhân, không mô tả cú pháp

[cli/feedback.ts](cli/feedback.ts) không viết `// sleep 100ms`. Nó viết:

> *Drain buffered keypresses so a prompt does not immediately consume input typed while the previous screen was still rendering.*

Đây là loại comment duy nhất có giá trị lâu dài: nó ghi lại **một bug đã xảy ra**. Người đọc sau 6 tháng biết được nếu xoá dòng đó thì hỏng cái gì. Toàn bộ [checks/parser-check.mts](checks/parser-check.mts) và [checks/capture-fixtures.mts](checks/capture-fixtures.mts) viết theo cùng phong cách — mỗi ràng buộc thiết kế đều có lý do đi kèm, kể cả lý do *không* làm gì đó (vì sao search không capture được fixture, vì sao capture tool không nằm trong `npm test`).

### 2.2. Discriminated union thay cho string tự do

[provider-types.ts](provider-types.ts) là 78 dòng có mật độ giá trị cao nhất trong repo:

```ts
export const PROVIDER_IDS = ['animevietsub', 'anime47', 'animehay'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]
```

kèm type guard (`isProviderId`, `isAccountProviderId`, `isHomeListAction`) và union hành động (`SettingsAction`, `AccountAction`, `HomeAction`) dẫn xuất bằng `Extract<>`. Kết quả: thêm một provider mới thì compiler chỉ ra mọi chỗ cần cập nhật, thay vì phát hiện lúc runtime.

### 2.3. Trả lỗi bằng result union, không throw xuyên tầng

```ts
export async function withSilentSpinner<T>(
  message: string, task: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }>
```

Đây là điểm sáng về kiến trúc: spinner (presentation) và error (domain) không còn dính vào nhau, và caller **bị buộc** phải xử lý nhánh lỗi. So sánh với tầng cũ, nơi lỗi được xử lý bằng `catch { /* non-fatal */ }` — xem §4.3.

### 2.4. Test offline, deterministic, và đã được chứng minh không rỗng

[checks/parser-check.mts](checks/parser-check.mts) làm ba việc mà phần lớn test tự viết bỏ qua:

1. **Chặn mạng cứng** — `globalThis.fetch` được thay bằng hàm throw ([parser-check.mts:38-42](checks/parser-check.mts#L38-L42)). Điều này phát hiện một vấn đề thật: `getAnimeDetail` gọi `enrichWithAniList`, vốn non-throwing, nên test sẽ *âm thầm* đi ra AniList thật.
2. **Assertion cấu trúc, không so khớp nội dung** — fixture là snapshot site thật, title/số tập đổi mỗi lần recapture. Cái bất biến là *shape*: id không trùng, số tập dương và sắp tăng, URL absolute.
3. **Mutation check** — đã xác minh test thật sự fail khi parser hỏng (thay fixture bằng trang rỗng). Không có bước này, một test suite xanh không chứng minh được gì.

Và test này đã trả lại giá trị ngay: nó phát hiện `Anime47.getHomeCards('latest')` **luôn trả về rỗng** trên production, do homepage chuyển sang Quasar SPA và không còn ship `__INITIAL_STATE__` — nguồn duy nhất set `status`, mà filter lại dựa trên `status`. Một bug người dùng nhìn thấy được, tìm ra bởi 198 dòng test offline.

### 2.5. Tách commit theo scope

Lịch sử gần đây (`2bee169` type foundation → `0bdecc3` tách CLI → `48a63bd` tooling) tuân thủ nguyên tắc *không trộn formatting với behavior*. Đối lập với lịch sử cũ: `0a78823 fix directory`, `bb0b50d delete: chỉnh sửa file package.json`. Cùng một tác giả, cách nhau hai tháng — đây là bằng chứng trực quan nhất về sự tiến bộ.

---

## 3. Tầng cũ: phân bố nợ kỹ thuật

Số dòng theo file, sắp giảm dần:

| File | Dòng | `any` | `catch` | Ghi chú |
| --- | ---: | ---: | ---: | --- |
| [scrapers/providers/animevietsub.ts](scrapers/providers/animevietsub.ts) | 1983 | 7 | 39 | God class |
| [scrapers/auth-service.ts](scrapers/auth-service.ts) | 1253 | 21 | 43 | 2 provider trong 1 file |
| [scrapers/providers/anime47.ts](scrapers/providers/anime47.ts) | 1025 | 15 | 22 | |
| [scrapers/providers/animehay.ts](scrapers/providers/animehay.ts) | 676 | 0 | 17 | **đã abandon** |
| [scrapers/anilist-api.ts](scrapers/anilist-api.ts) | 639 | 3 | 8 | client AniList #1 |
| [player-main.js](player-main.js) | 433 | — | 12 | **ESLint bỏ qua** |
| [webview-preload.js](webview-preload.js) | 418 | — | 18 | **ESLint bỏ qua** |
| [prompts-wrapper.ts](prompts-wrapper.ts) | 390 | 15 | — | seam untyped |
| [scrapers/crawler.ts](scrapers/crawler.ts) | 357 | 0 | 8 | |
| [scrapers/interceptor.ts](scrapers/interceptor.ts) | 306 | 16 | 7 | |
| [storage.ts](storage.ts) | 267 | 0 | 6 | crypto + side effect |

Tổng ~42 catch rỗng. 3.261 dòng — 28% codebase — nằm trong 2 file.

### 3.1. God class: animevietsub.ts

Một class duy nhất sở hữu: danh sách domain dự phòng, browser profile, `static readonly throttle = new HostThrottle(800)`, `static readonly blockedHostCache`, retry có jitter, build header, heuristic nhận URL quảng cáo, phân loại timeout, `fetchHtml` (phát hiện Cloudflare + leo thang sang Playwright), `fetchHtmlWithPlaywright`, parse cheerio, `selectCardElements` với nhiều chiến lược fallback, parse IMDb, schedule, home cards, search, detail, episodes, video servers, **bốn** stream extractor (`extractFromAbyssServer`, `extractFromDUServer`, `extractFromAPIServer`, `extractWithPlaywright`), và `decodeHtml`.

Điều đáng chú ý về mặt kiến trúc: state đáng lẽ phải là hạ tầng dùng chung (`throttle`, `blockedHostCache`) lại là `static` **trên class provider**. Nghĩa là throttle của AnimeVietsub không biết gì về request của Anime47 tới cùng CDN, và cache host bị block không chia sẻ được. Đây là dấu hiệu điển hình của code lớn lên theo hướng "thêm vào file đang mở" chứ không theo hướng "cái này thuộc về tầng nào".

### 3.2. auth-service.ts: hai provider trong một file

1253 dòng chứa cả `loginAnimeVietsubInteractive`, `parseAvsAnimeList`, `parseAvsPagination`, `fetchAvsPage`, `buildAvsHeaders` **và** `loginAnime47Interactive`, `buildA47Headers`, `getA47ApiBase`, `mapA47Item`, `interceptA47StreamUrl`, `fetchAnime47Profile`. 21 `any` và 43 `catch` — mật độ cao nhất repo.

Chi tiết đáng ghi lại vì nó lặp ở nhiều nơi: base URL của API được suy ra bằng phép thay chuỗi trên TLD:

```ts
const A47_API = A47_BASE.replace(/\.[a-z]+$/, '.love') + '/api'
```

Đây là một suy luận về hạ tầng của bên thứ ba được nhúng vào biểu thức chính quy, không có comment nói vì sao `.love`, và bản thân `A47_API` hiện **không được dùng** (dead code). Ba tầng nợ trong một dòng.

---

## 4. Năm mẫu lỗi hệ thống

Đây là phần có giá trị nhất cho cộng đồng: các lỗi không nằm ở một dòng, mà ở việc **cùng một quyết định bị lặp lại**.

### 4.1. Cùng một logic, hai nguồn sự thật

Đếm được bốn cặp:

**(a) Hai AniList client, một quota.**
[scrapers/anilist-api.ts](scrapers/anilist-api.ts) (639 dòng) có `AniListApiService` với TTL cache, `rateLimitRemaining`, `rateLimitReset`, `requestQueue` — làm đúng bài. Nó chỉ được import bởi [scrapers/external-api.ts](scrapers/external-api.ts), một lớp pass-through 67 dòng.
Song song đó, [scrapers/anilist.ts](scrapers/anilist.ts) (95 dòng) export `enrichWithAniList` — **client thứ hai tới cùng endpoint `https://graphql.anilist.co`**, với `Map` cache không giới hạn và không có rate limiting nào. Nó được dùng bởi [discord.ts:88](discord.ts#L88), [anime47.ts:711](scrapers/providers/anime47.ts#L711), [animevietsub.ts:1240](scrapers/providers/animevietsub.ts#L1240).
Hệ quả: toàn bộ công sức rate-limit ở client #1 bị vô hiệu, vì client #2 tiêu cùng quota mà không biết client #1 tồn tại.

**(b) Hai bản giải mã cookie.** [player-main.js](player-main.js) `injectStoredCookies()` sao chép nguyên văn crypto của [storage.ts](storage.ts): cùng seed `nekostream-cli:${os.hostname()}:${os.userInfo().username}:auth-v1`, cùng `aes-256-cbc`, cùng fallback `plain:`. Đổi thuật toán ở một nơi là hỏng nơi còn lại — và nơi còn lại là file mà ESLint không đọc.

**(c) Hai đường resolve domain.** [storage.ts:81](storage.ts#L81) ghi thẳng trong comment: *"Mirrors the domain injection logic in providers.ts getProvider()"*. Trùng lặp được **thừa nhận bằng comment thay vì được sửa**. Đây là một anti-pattern đáng đặt tên: comment biến nợ thành "đã biết", và "đã biết" tạo cảm giác đã xử lý.

**(d) Hai domain cho cùng một provider.** [storage.ts:76](storage.ts#L76) khai `animehay: 'https://animehay.ink'`, còn [animehay.ts](scrapers/providers/animehay.ts) khai `https://animehay01.site`. Đã ghi nhận là nợ chấp nhận được sau quyết định abandon AnimeHay, nhưng nó minh hoạ chính xác kết cục của mẫu (c).

Thêm vào đó, ad-blocking tồn tại ở **bốn** cài đặt độc lập: `@ghostery/adblocker` trong [auth-service.ts:120](scrapers/auth-service.ts#L120), `applyAdBlockingToPage` ở [auth-service.ts:203](scrapers/auth-service.ts#L203), `enableAdBlocking` trong [crawler.ts:130](scrapers/crawler.ts#L130), và danh sách keyword thủ công trong [player-main.js:67](player-main.js#L67).

### 4.2. Quyết định bảo mật bằng so khớp chuỗi con

Xuyên suốt tầng cũ, kiểm tra host được viết bằng `includes()`:

```js
lowerUrl.includes('animevietsub')      // player-main.js
tabUrl.includes('animevietsub')
includes('abyss'|'hydrax'|'googleapis'|'localhost')   // will-navigate allowlist
```

`https://animevietsub.evil.example/` thoả tất cả. Kiểm tra tin cậy phải làm trên `new URL(u).hostname` với so khớp chính xác hoặc hậu tố có dấu chấm, không phải trên chuỗi thô.

Cùng lỗi này khiến ad-block sai: danh sách keyword tại [player-main.js:73](player-main.js#L73) chứa token trần `'bet'`, khớp mọi URL có chữ "bet" (`betterstream`, `alphabet`, `bethesda`...), và có phần tử trùng (`'quayhu'`, `'nohu'` xuất hiện hai lần ở [player-main.js:73](player-main.js#L73) và [player-main.js:272](player-main.js#L272)). Blocklist này chưa từng được review — cách duy nhất để nó được review là có test, mà file này thì ESLint cũng không đọc.

### 4.3. `catch {}` như một chiến lược

~42 khối catch rỗng. Một vài trường hợp hợp lệ (dọn dẹp trong `finally`: `await page.close().catch(() => {})`). Nhưng đa số không:

```ts
} catch { /* non-fatal */ }   // auth-service.ts, quanh phần detect username
```

Vấn đề không phải là bỏ qua lỗi — có lúc đúng. Vấn đề là **không phân biệt được** "lỗi này dự kiến và vô hại" với "lỗi này chưa từng nghĩ tới". Khi site đổi markup, `catch {}` biến một lỗi parse thành một tính năng im lặng biến mất. Đây chính là cơ chế đã giấu bug `getHomeCards('latest')` rỗng: không có gì báo lỗi, section chỉ đơn giản là trống.

Điều làm mẫu này trở thành *hệ thống* chứ không phải cá nhân: [eslint.config.mjs](eslint.config.mjs) **tắt `no-empty`**. Tức là quy tắc duy nhất có thể phát hiện nó đã được vô hiệu hoá.

### 4.4. Trạng thái toàn cục có thể mutate

[providers.ts](providers.ts) chỉ 35 dòng nhưng chứa hai vấn đề:

```ts
export const providers: Record<ProviderId, BaseScraper> = {
  animevietsub: new AnimeVietsubProvider(), /* ... */ }

export function getProvider(name: ProviderId | string): BaseScraper {
  const { loadSettings } = require('./storage')      // inline require: né circular import
  provider.baseUrl = customDomain.replace(/\/$/, '') // mutate singleton dùng chung
```

`getProvider()` — tên gợi ý một getter thuần — thực chất **ghi vào** state chia sẻ toàn process. Và `require()` giữa thân hàm là dấu vết của một vòng import chưa được giải quyết: workaround được giữ lại thay vì cấu trúc lại phụ thuộc. Cả hai đều là lý do khiến provider khó test — và đúng là test phải cast provider để monkey-patch `fetchHtml` private.

### 4.5. Side effect lúc import

[storage.ts:15-22](storage.ts#L15-L22) chạy I/O ở top level, ngay khi module được load:

```ts
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(OLD_DATA_DIR)) {
    try { fs.cpSync(OLD_DATA_DIR, DATA_DIR, { recursive: true }) } catch (e) {}
  }
}
```

Một migration đệ quy copy thư mục, chạy như tác dụng phụ của `import`, lỗi bị nuốt hoàn toàn. Không thể test, không thể tắt, không thể quan sát. Bất kỳ file nào chỉ cần một type từ `storage.ts` cũng kích hoạt nó.

Thêm nữa: mọi lần gọi `getProviderCookieHeader`/`getProviderToken` đều đọc lại file, parse lại JSON, giải mã lại toàn bộ — không cache.

---

## 5. Tư thế bảo mật

Đây là phần cần nói thẳng nhất, vì đây là ứng dụng chạy nội dung web không tin cậy trong Electron.

### 5.1. Renderer chạy với toàn quyền

[player-main.js:45-48](player-main.js#L45-L48):

```js
webPreferences: {
  nodeIntegration: true,
  contextIsolation: false,
  webSecurity: false,     // Required for some streams (CORS bypass)
  webviewTag: true,
  autoplayPolicy: 'no-user-gesture-required'
}
```

Đây là bốn thiết lập mà tài liệu Electron gọi thẳng là không nên dùng, bật đồng thời, trong một cửa sổ hiển thị trang từ site scraping và iframe của CDN bên thứ ba. Cộng thêm:

- **CSP bị xoá toàn cục.** `content-security-policy`, `content-security-policy-report-only` và `x-frame-options` bị strip cho `*://*/*` trên **mọi** session ([player-main.js:127-129](player-main.js#L127-L129)). Lớp phòng thủ cuối cùng của trang web bị vô hiệu ở mọi origin, không chỉ origin cần thiết.
- **Preload còn xoá CSP dạng meta tag** ([webview-preload.js:384](webview-preload.js#L384)).
- **Remote code execution theo thiết kế.** [webview-preload.js:399](webview-preload.js#L399) tải Eruda từ `https://cdn.jsdelivr.net/npm/eruda` (fallback cdnjs) **không điều kiện** trên trang player. Một script từ CDN ngoài, không pin version, không SRI, chạy trong renderer có `nodeIntegration: true`. Nếu CDN đó bị chiếm, người dùng mất máy — không chỉ mất tab. Đây phải là opt-in sau cờ debug, tối thiểu.
- **Input hình dạng không tin cậy được parse không kiểm tra.** [player-main.js:29](player-main.js#L29): `JSON.parse(Buffer.from(streamData, 'base64').toString('utf-8'))` từ biến môi trường `NEKOSTREAM_CLI_STREAM`, không validate schema trước khi dùng làm URL/cookie/localStorage.
- **IPC không xác thực sender.** `player:minimize` / `player:toggle-maximize` không kiểm tra `event.sender`.
- **Ghi artifact runtime vô điều kiện.** [player-main.js:242](player-main.js#L242) ghi `dom-dump.html` vào `__dirname` — tức là vào thư mục package đã cài — mỗi lần chạy, không cần debug mode, và bằng `writeFileSync` trong main process.

### 5.2. Preload là một lớp monkey-patch sâu

[webview-preload.js](webview-preload.js) ghi đè `document.createElement`, `window.fetch`, `XMLHttpRequest.prototype.open/send`, `window.setInterval`, `window.setTimeout`, giả lập `googletag`/`adsbygoogle`/`__tcfapi`/`__uspapi`/`fbq`, và bọc `window.Function` trong một `Proxy` để vô hiệu bẫy `debugger` ([webview-preload.js:271](webview-preload.js#L271)).

Về mặt kỹ thuật, đây là code khéo. Về mặt bảo trì, đây là 418 dòng phụ thuộc vào chi tiết nội bộ của các site không kiểm soát, có 18 khối catch, và không có một test nào. Cộng với `setInterval(cleanDOM, 300)` và ở phía main `setInterval(clean, 250)` quét `querySelectorAll('div,section,article,button,a,span,img')` kèm `getComputedStyle` — một vòng lặp CPU chạy 4 lần/giây suốt thời gian phát video.

### 5.3. Mã hoá session không có toàn vẹn, và có đường hạ cấp im lặng

[storage.ts:172-191](storage.ts#L172-L191): `aes-256-cbc` với key dẫn xuất từ hostname + username. Hai vấn đề độc lập:

1. **CBC không có authentication tag.** Không phát hiện được ciphertext bị sửa. Cần GCM, hoặc keychain của hệ điều hành.
2. **Hạ cấp im lặng.** Khi mã hoá thất bại, `encryptPayload` trả về `'plain:' + base64(raw)`; `decryptPayload` chấp nhận tiền tố `plain:` **vô điều kiện**. Nghĩa là bất kỳ ai ghi được file cũng có thể thay bằng plaintext base64 và nó sẽ được đọc bình thường. Lớp mã hoá trở thành trang trí.

Cần nói rõ về mức độ: key dẫn xuất từ danh tính máy nên đây không phải bí mật thật ngay từ đầu — nó là obfuscation. Vấn đề là code *trông như* mã hoá, nên người bảo trì sau sẽ tin nó là mã hoá.

---

## 6. Quality gate: chỗ hổng lớn nhất

Đây là phát hiện quan trọng nhất của đánh giá này, và là lý do chính để viết nó ra.

[eslint.config.mjs](eslint.config.mjs) — 48 dòng — `ignores` ba file:

```
player-main.js, webview-preload.js, isolate.js
```

Đó chính xác là ba file rủi ro cao nhất trong repo: toàn bộ bề mặt Electron, toàn bộ code injection, toàn bộ vấn đề ở §5. Và các rule bị tắt:

`@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars`, `no-empty`, `prefer-const`, `@typescript-eslint/no-require-imports`, `preserve-caught-error`, `no-control-regex`, `no-useless-assignment`.

Đối chiếu với §3/§4: rule bị tắt tương ứng 1:1 với mẫu lỗi tồn tại. `no-explicit-any` tắt → 80 `any`. `no-unused-vars` tắt → 7 symbol chết chỉ phát hiện được khi chạy tay `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`. `no-empty` tắt → 42 catch rỗng. `no-require-imports` tắt → `require()` giữa thân hàm ở [providers.ts](providers.ts).

[tsconfig.json](tsconfig.json) cùng hình dạng: `strict: true` (tốt), nhưng thiếu `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, và bật `skipLibCheck`.

**Bài học chung:** cấu hình linter để pass là hành vi tự nhiên khi thêm linter vào codebase đã có. Nhưng kết quả là một gate báo xanh trên chính những file cần gate nhất. Một `ignores` không kèm ngày hết hạn hoặc issue theo dõi thì không phải "tạm thời" — nó là vĩnh viễn. Cách làm đúng: bật rule ở mức `warn` với `--max-warnings` là con số hiện tại, rồi giảm dần; hoặc ghi rõ trong config lý do và điều kiện xoá `ignores`.

### 6.1. Độ phủ test

`npm test` = `search-check.mts` + `parser-check.mts` = 426 dòng test cho 11.528 dòng source. Chất lượng test cao (§2.4) nhưng phủ hẹp:

| Vùng | Test |
| --- | --- |
| Xếp hạng search | ✅ |
| Parser AVS/A47 | ✅ (fixture offline) |
| Nội dung package | ✅ (`pack:check`) |
| Auth (1253 dòng) | ❌ |
| Stream extraction | ❌ |
| Policy player/IPC | ❌ |
| Storage/crypto | ❌ |
| Prompt layer | ❌ |

Đáng chú ý: `storage.ts` crypto là code **thuần** (vào chuỗi, ra chuỗi) — dễ test nhất trong repo, và là nơi có lỗ hạ cấp `plain:`. Một test 10 dòng khẳng định "payload plaintext bị từ chối" đã đủ chặn. Đây là mẫu phổ biến: phần dễ test nhất lại bị bỏ qua vì nó không "trông giống" phần cần test.

---

## 7. Bảng điểm

| Tiêu chí | Điểm | Cơ sở |
| --- | :---: | --- |
| Kiến trúc (tầng mới) | 8/10 | Tách CLI sạch, union type, module dưới 250 dòng |
| Kiến trúc (tầng cũ) | 3/10 | God class 1983 dòng, static state, singleton bị mutate |
| Type safety | 6/10 | `strict: true` nhưng 80 `any`; `source: string` thay vì `ProviderId` |
| Xử lý lỗi | 3/10 | 42 catch rỗng, không có taxonomy lỗi, `no-empty` bị tắt |
| Bảo mật | 2/10 | §5 — Electron mở toàn bộ, RCE qua CDN, crypto có đường hạ cấp |
| Test | 5/10 | Chất lượng cao, phủ hẹp, vùng rủi ro nhất không phủ |
| Quality gate | 5/10 | Có CI đầy đủ, nhưng miễn trừ đúng file rủi ro nhất |
| Tài liệu (code) | 7/10 | Tầng mới xuất sắc, tầng cũ gần như không có |
| Lịch sử Git | 7/10 | Commit gần đây theo convention và tách scope; commit cũ ad-hoc |
| Vệ sinh repo | 8/10 | `.data` đã untrack, `dist` không track, `pack:check` tự động |

**Trung bình có trọng số: ~5.5/10** — với độ lệch rất lớn giữa hai tầng. Đây không phải điểm của một codebase trung bình đồng đều; đây là điểm của một codebase đang chuyển pha, chụp giữa lúc chuyển.

---

## 8. Bảy bài học cho cộng đồng

Rút từ chính codebase này, không phải từ sách.

1. **Linter `ignores` không có ngày hết hạn là vĩnh viễn.** Nếu phải bỏ qua file để CI xanh, hãy ghi kèm issue và điều kiện xoá — nếu không, gate sẽ báo xanh mãi mãi trên đúng phần nguy hiểm nhất.

2. **Comment thừa nhận trùng lặp không phải là sửa trùng lặp.** *"Mirrors the domain injection logic in providers.ts"* biến nợ thành "đã biết", và "đã biết" cho cảm giác đã xử lý. Kết cục có thể thấy ngay trong repo: hai domain khác nhau cho cùng một provider.

3. **Test cái dễ test trước, không cái trông đáng test.** Hàm crypto thuần là phần dễ test nhất và là nơi có lỗ hạ cấp `plain:`. Nó không được test vì nó không "trông giống" test.

4. **Chứng minh test có thể fail.** Mutation check (thay fixture bằng trang rỗng) là bước biến "suite xanh" thành bằng chứng. Bỏ bước này thì suite xanh không nói gì cả.

5. **`includes()` không phải kiểm tra bảo mật.** Parse URL, so khớp hostname chính xác hoặc theo hậu tố có dấu chấm. Cùng lỗi này vừa tạo lỗ bảo mật (host giả mạo) vừa tạo bug (`'bet'` khớp `alphabet`).

6. **`catch {}` xoá dữ liệu chẩn đoán mà bug cần nhất.** Section rỗng thay vì lỗi rõ ràng là hệ quả trực tiếp. Nếu thật sự cần bỏ qua, hãy log ở mức debug và ghi lý do.

7. **Refactor đúng thứ tự sẽ tự trả tiền.** Fixture test viết ở Phase 2.5 — *trước* khi tách provider — đã tìm ra một bug production ngay trong ngày viết. Nguyên tắc "viết test cho parser trước khi di chuyển logic" không phải nghi thức; nó là cách để phase tiếp theo không cần cầu nguyện.

---

## 9. Nợ đã ghi nhận, chưa xử lý

Danh sách này là kết quả của đánh giá, không phải kế hoạch — mọi việc code đang tạm dừng theo yêu cầu.

**Chặn phát hành (nên xử lý trước khi khuyến nghị người khác dùng):**
- Eruda tải từ CDN không điều kiện trong renderer có `nodeIntegration: true` ([webview-preload.js:399](webview-preload.js#L399)).
- Đường hạ cấp `plain:` trong [storage.ts:183](storage.ts#L183).
- Ghi `dom-dump.html` vô điều kiện vào thư mục package ([player-main.js:242](player-main.js#L242)).

**Cao:**
- `contextIsolation: false` + `nodeIntegration: true` ở renderer chính (Phase 6).
- CSP/XFO bị strip cho `*://*/*` — cần thu hẹp về đúng origin cần thiết.
- Kiểm tra host bằng `includes()` → chuyển sang allowlist hostname.
- Hợp nhất hai AniList client về một, giữ bản có rate limiting.
- Hợp nhất hai bản giải mã cookie.

**Trung bình:**
- Tách [animevietsub.ts](scrapers/providers/animevietsub.ts) (Phase 4) và [auth-service.ts](scrapers/auth-service.ts) (Phase 5).
- `source: string` → `ProviderId` trong [scrapers/base.ts](scrapers/base.ts) — Phase 1 dừng ở biên CLI, chưa vào domain model scraper.
- Bỏ side effect lúc import trong `storage.ts`; thêm cache cho đường đọc session.
- Type hoá `prompts(options: any)`; thay sentinel `'__GOBACK__'`; bỏ điều khiển luồng dựa trên regex trên chuỗi hiển thị (`shouldOfferBack`).
- Bật lại `no-empty`, `no-unused-vars`, `no-explicit-any` ở mức `warn` với ngưỡng giảm dần; bỏ `ignores`.
- Xoá 7 symbol chết đã xác định; ra quyết định về export `showAccountMenu`.
- Hợp nhất 4 cài đặt ad-block về một policy.

**Đã quyết định chấp nhận:**
- Mismatch domain AnimeHay (`storage.ts` vs `animehay.ts`) — hệ quả của quyết định abandon.
- Identifier `configureAnimehаyCacheHooks` có ký tự Cyrillic trong tên.

---

## 10. Ghi chú về phương pháp

Mọi con số trong tài liệu này đo được lại bằng:

```bash
git ls-files | grep -E '\.(ts|mts|js|mjs)$' | xargs wc -l | sort -rn   # LOC
git ls-files | grep -E '\.(ts|js)$' | xargs grep -c ': any\|<any>'     # any
git ls-files | grep -E '\.(ts|js)$' | xargs grep -c 'catch'            # catch
npx tsc --noEmit --noUnusedLocals --noUnusedParameters                 # dead code
npm run check                                                          # gate hiện tại
```

Không file nào bị sửa trong quá trình đánh giá. [DESIGN.md](DESIGN.md), `issues.json` và `.data/` local giữ nguyên trạng theo ràng buộc đã thống nhất.
