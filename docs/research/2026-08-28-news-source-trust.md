# Nghiên cứu hiển thị nội dung báo và tín hiệu độ tin cậy nguồn cho TechBridgeAI

**Ngày kiểm chứng:** 2026-08-28  
**Phạm vi:** chỉ dùng chuẩn web, RFC, tài liệu Google Search Central, Schema.org, C2PA và OWASP.  
**Trạng thái:** đề xuất sản phẩm/kỹ thuật, chưa sửa mã nguồn.

## Kết luận ngắn

Không nên dùng `iframe` làm cơ chế chính để hiển thị bài báo trong app. Về kỹ thuật, nhiều trang có thể chặn nhúng bằng `Content-Security-Policy: frame-ancestors` hoặc `X-Frame-Options`; kể cả khi nhúng được thì same-origin policy vẫn ngăn app đọc/điều khiển DOM của trang báo cross-origin. Frontend cũng không thể tự `fetch()` HTML của hầu hết báo chí nếu server bên kia không bật CORS. Vì vậy phương án mặc định nên là: tìm URL gốc, lấy metadata + excerpt ở server, render bản xem nhanh đã làm sạch trong app, và luôn giữ nút mở bài gốc. `iframe` chỉ nên là fallback preview khi trang cho phép nhúng. ([HTML Standard](https://html.spec.whatwg.org/multipage/iframe-embed-object.html), [MDN: same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [MDN: CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [RFC 7034](https://www.rfc-editor.org/info/rfc7034/))

UI cũng không nên tuyên bố nhị phân kiểu “đúng/sai” hay “đã xác minh”. Nên hiển thị “nguồn gốc” và “tín hiệu xuất bản” để người dùng tự đánh giá: publisher, author, ngày xuất bản/chỉnh sửa, canonical URL, structured data, chính sách biên tập nếu có, và mức đồng thuận liên nguồn. Đây là các tín hiệu provenance có chuẩn máy đọc sẵn trên web, nhưng không đủ để kết luận chân lý. ([Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), [Schema.org `author`](https://schema.org/author), [Schema.org `publisher`](https://schema.org/publisher), [Schema.org `reviewedBy`](https://schema.org/reviewedBy), [Schema.org `publishingPrinciples`](https://schema.org/publishingPrinciples), [Schema.org `sameAs`](https://schema.org/sameAs), [Schema.org `mainEntityOfPage`](https://schema.org/mainEntityOfPage))

## 1. Hiển thị nội dung bài báo trong app

### Khuyến nghị

Mặc định:

1. Lưu `original_url`.
2. Chuẩn hóa `canonical_url` nếu có.
3. Ở server, lấy metadata và excerpt ngắn.
4. Render text/plain hoặc HTML đã sanitize trong app.
5. Giữ CTA `Xem bài gốc`.

Chỉ dùng `iframe` khi mục tiêu là “xem nguyên trang từ publisher” và trang đó thực sự cho nhúng. Nếu dùng `iframe`, đặt `sandbox` chặt, thêm `referrerpolicy`, và chấp nhận rằng nhiều báo sẽ bị chặn bởi `frame-ancestors` hoặc `X-Frame-Options`. `iframe` không giải bài toán trích nội dung; nó chỉ là một cách hiển thị trang từ xa. ([HTML Standard](https://html.spec.whatwg.org/multipage/iframe-embed-object.html), [MDN: CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [RFC 7034](https://www.rfc-editor.org/info/rfc7034/), [MDN: Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy))

### Vì sao không nên dựa vào `iframe`

- Chủ trang quyết định có cho nhúng hay không qua `frame-ancestors` và `X-Frame-Options`; app không ép được. ([MDN: CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [RFC 7034](https://www.rfc-editor.org/info/rfc7034/))
- Same-origin policy ngăn code của app tương tác sâu với nội dung cross-origin trong frame. ([MDN: same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy))
- Frontend `fetch()` HTML cross-origin thường bị chặn nếu không có CORS phù hợp, nên muốn lấy nội dung đọc được thì phải làm ở server hoặc dùng feed/license chính thức. ([MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS))

### Hệ quả thực dụng

Giải pháp ngắn nhất mà vẫn bền là “server-side extraction + original link”, không phải “client-side iframe reader”.

## 2. Tín hiệu độ tin cậy/provenance nên hiển thị

### Nên hiển thị

- `publisher`: tên publisher và domain gốc. ([Schema.org `publisher`](https://schema.org/publisher))
- `author`: tên tác giả và URL hồ sơ nếu có. Google còn khuyến nghị `author.url` hoặc `sameAs` để định danh tốt hơn. ([Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), [Schema.org `author`](https://schema.org/author), [Schema.org `sameAs`](https://schema.org/sameAs))
- `published_at` và `modified_at`: ngày đăng và ngày sửa ở định dạng ISO 8601 nếu publisher cung cấp. ([Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), [Schema.org `dateModified`](https://schema.org/dateModified))
- `canonical_url`: URL đại diện để tránh trùng lặp biến thể. ([Google canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [RFC 6596](https://www.rfc-editor.org/info/rfc6596/))
- `mainEntityOfPage`: tín hiệu cho biết trang này là trang chính mô tả thực thể/bài viết nào. ([Schema.org `mainEntityOfPage`](https://schema.org/mainEntityOfPage))
- `reviewedBy` và `publishingPrinciples`: nếu có thì đây là tín hiệu quy trình biên tập/fact-checking, nhưng nên hiển thị là “publisher khai báo”, không phải chứng nhận độc lập. ([Schema.org `reviewedBy`](https://schema.org/reviewedBy), [Schema.org `publishingPrinciples`](https://schema.org/publishingPrinciples))
- `isAccessibleForFree` và `license`: tín hiệu quyền truy cập và license, hữu ích cho chính sách hiển thị excerpt/lưu trữ. ([Schema.org `Article`](https://schema.org/Article), [Schema.org `license`](https://schema.org/license))
- `c2pa_present`: nếu ảnh/video trong bài có Content Credentials thì có thể hiện “có provenance mã hóa”, nhưng đây là tín hiệu mạnh hơn cho media asset, không thay thế đánh giá bài viết văn bản. ([C2PA Content Credentials](https://spec.c2pa.org/specifications/specifications/2.3/specs/ContentCredentials.html))
- `cross_source_count`: số nguồn độc lập cùng xác nhận cùng một thực thể/sự kiện. Đây là suy luận sản phẩm từ nhiều nguồn chứ không phải trường chuẩn web, nhưng rất phù hợp để tránh confidence “cố định”. 

### Không nên hiển thị

- `True / False`
- `Nguồn này đáng tin 92%`
- `Đã xác minh` nếu hệ thống mới chỉ có metadata/scrape

### Ngôn ngữ UI nên dùng

- `Bài gốc`
- `Bản xem nhanh do hệ thống trích xuất`
- `Nguồn gốc`
- `Tín hiệu xuất bản`
- `Đồng thuận liên nguồn`
- `Không đủ dữ kiện`
- `Publisher chặn nhúng`
- `Có metadata tác giả/publisher`
- `Có dấu hiệu đã chỉnh sửa sau xuất bản`

## 3. Data model tối thiểu nên có

```ts
type SourceItem = {
  id: string;
  sourceType: "news" | "web" | "registry" | "company_site";
  originalUrl: string;
  canonicalUrl?: string;
  title?: string;
  publisher?: { name: string; url?: string };
  author?: Array<{ name: string; url?: string }>;
  publishedAt?: string;
  modifiedAt?: string;
  accessedAt: string;
  language?: string;
  snippet?: string;
  extractedText?: string; // excerpt ngắn, không phải full article mặc định
  rights?: {
    licenseUrl?: string;
    isAccessibleForFree?: boolean;
    robotsNoSnippet?: boolean;
    dataNoSnippetObserved?: boolean;
  };
  provenance?: {
    reviewedBy?: string[];
    publishingPrinciplesUrl?: string;
    c2paPresent?: boolean;
    crossSourceCount?: number;
  };
  delivery?: {
    iframeAllowed?: boolean;
    fetchMethod: "search-snippet" | "server-extract" | "iframe";
  };
};
```

Phần tối thiểu thật sự cần cho UI trước mắt là: `originalUrl`, `canonicalUrl`, `title`, `publisher`, `author`, `publishedAt`, `modifiedAt`, `snippet`, `extractedText` ngắn, `crossSourceCount`, `iframeAllowed`, `licenseUrl/isAccessibleForFree`. Các field khác nên chỉ thêm khi thu được ổn định từ nguồn thực tế.

## 4. Có cần người dùng cung cấp thêm nguồn không?

Không bắt buộc. Hệ thống có thể tìm rộng trên web và báo chí làm mặc định; các chuẩn metadata ở trên vốn được thiết kế cho hệ sinh thái web mở, không phụ thuộc một publisher duy nhất. Tuy vậy, nên cho người dùng ba mức kiểm soát:

1. `Search broadly`
2. `Prefer these domains`
3. `Only these domains`

Đây là suy luận kiến trúc từ cách chuẩn web/structured data/canonical/robots hoạt động trên web mở, không phải một yêu cầu chuẩn bắt buộc. Về sản phẩm, broad search là mặc định hợp lý; user-provided sources nên là bộ lọc/boost/compliance control, không phải điều kiện để app hoạt động.

## 5. Privacy, copyright, security caveats

### Security

Server-side fetching mở ra bề mặt SSRF; phải chặn scheme nguy hiểm, private IP/ranges nội bộ, redirect chain bất thường, và giới hạn timeout/kích thước/content-type. ([OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html))

Nếu render HTML trích xuất, phải sanitize nghiêm ngặt; OWASP nêu rõ framework hiện đại vẫn có lỗ hổng khi dùng đường tắt như HTML injection trực tiếp. Mặc định an toàn hơn là render plain text hoặc HTML whitelist rất hẹp. ([OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html))

Nếu vẫn mở link/iframe tới publisher, nên đặt `referrerpolicy` chặt để tránh rò URL nội bộ hoặc query nhạy cảm qua header `Referer`. ([MDN: Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy), [HTML Standard](https://html.spec.whatwg.org/multipage/iframe-embed-object.html))

### Copyright và publisher intent

Google Search Central mô tả rõ snippet được tạo từ nội dung trang, và publisher có thể dùng `nosnippet`, `max-snippet`, `data-nosnippet` để hạn chế phần text được trích hiển thị trong search. Các cơ chế này ràng buộc Google chứ không tự động ràng buộc app của mình, nhưng chúng là tín hiệu rõ về ý định của publisher; nên coi đó là policy input cho việc trích excerpt và cache nội dung. ([Google snippet controls](https://developers.google.com/search/docs/appearance/snippet), [Google robots meta tags](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [Google special tags](https://developers.google.com/search/docs/crawling-indexing/special-tags))

`robots.txt` không phải cơ chế bảo mật và không buộc mọi crawler phải tuân thủ; vì vậy không nên diễn giải “không bị chặn robots” thành “được phép làm mọi thứ với nội dung”. ([Google robots.txt intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro))

Ngưỡng an toàn thực dụng:

- mặc định chỉ lưu `metadata + snippet + excerpt ngắn + hash`, không lưu full HTML/article body vĩnh viễn;
- ưu tiên mở bài gốc thay vì tái bản toàn văn trong app;
- nếu một nguồn có `license` rõ ràng hoặc feed/licensing chính thức, mới nâng mức lưu trữ/hiển thị;
- nếu nguồn đánh dấu `isAccessibleForFree = false` hoặc là paywalled/subscription, chỉ nên hiển thị metadata và trích đoạn rất ngắn.

## 6. Đề xuất product tối giản cho TechBridgeAI

Mỗi finding nên có hai tầng:

1. `Evidence card`: tiêu đề, publisher, ngày, snippet/excerpt, nút `Bài gốc`.
2. `Source signals`: author, canonical URL, modified date, reviewedBy/publishingPrinciples nếu có, đồng thuận liên nguồn.

Điểm “confidence” hiện tại nên đổi thành `signal summary`, ví dụ:

- `3 nguồn độc lập, có publisher + author + ngày đăng`
- `1 nguồn duy nhất, thiếu author, bài đã sửa sau xuất bản`
- `Publisher chặn nhúng; chỉ hiển thị metadata và bài gốc`

Đó là cách nói trung thực hơn với dữ liệu hệ thống thực sự có.
