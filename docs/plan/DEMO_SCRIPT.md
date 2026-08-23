# PartnerIQ — Demo Script (3-5 Phút)

> Kịch bản trình diễn sản phẩm Company Intelligence Agent tại Google AI Hackathon 2026.

---

## 🎬 Mục tiêu Demo
Chứng minh PartnerIQ giải quyết triệt để bài toán:
1. **Nghiên cứu tự động đa nguồn tin cậy:** (Web Search, Tiered Website Scraping `Direct → Jina → TinyFish`, Tin tức, VietQR Registry, LinkedIn).
2. **SSRF & Security Guards:** Chặn triệt để IP nội bộ, loopback, private ranges, redirect sang mạng kín; không sinh dữ liệu giả.
3. **Streaming thời gian thực:** (Real-time SSE progress & findings log).
4. **Tổng hợp hồ sơ chuẩn hóa:** Kèm trích dẫn nguồn (Citations) và VietQR structured record.
5. **Phân tích Tiềm năng Hợp tác (Collaboration Fit Score):** Với 5 tiêu chí trọng số minh bạch.
6. **Phát hiện thay đổi theo thời gian ("What changed?" Diff Engine):** So sánh đa phiên bản trong Supabase.
7. **Xuất báo cáo đa định dạng:** (Markdown & JSON).

---

## ⏱️ Kịch bản chi tiết theo từng phút

### Phút 0:00 – 0:45: Nêu Pain Point & Giới thiệu PartnerIQ
- **Lời thoại (Talk track):**
  > "Kính chào Ban Giám khảo. Mỗi khi cần thẩm định một đối tác doanh nghiệp, cán bộ phát triển kinh doanh phải mất từ 2 đến 3 tiếng tìm kiếm thủ công trên Google, đọc tin tức, tra cứu cổng đăng ký kinh doanh và copy vào file Word. Thông tin vừa dễ thiếu sót, vừa không có cơ chế phát hiện những thay đổi quan trọng như đổi CEO, tăng vốn hay có tin xấu pháp lý.
  >
  > Hôm nay, chúng tôi giới thiệu **PartnerIQ** — AI Research Agent tự động hóa toàn bộ quy trình nghiên cứu, chuẩn hóa hồ sơ và đánh giá tiềm năng hợp tác cho doanh nghiệp Việt Nam chỉ trong 60 giây."

---

### Phút 0:45 – 2:00: Demo Luồng Nghiên cứu Real-time & Tiered Resilience
- **Thao tác trên màn hình:**
  1. Mở giao diện PartnerIQ tại `http://localhost:3000`.
  2. Nhập:
     - **Tên công ty:** `FPT Corporation`
     - **Mã số thuế:** `0101248141`
     - **Website:** `https://fpt.com.vn` (hoặc để trống để Agent tự khám phá).
  3. Bấm **"🔍 Bắt đầu nghiên cứu"**.
- **Lời thoại & Điểm nhấn:**
  > "Ngay khi bấm bắt đầu, hệ thống kích hoạt **ResearchModule** kết nối các Adapter theo cơ chế bảo vệ phân lớp:
  > - **Web Search Adapter** tìm kiếm các từ khóa tiếng Việt và mã số thuế.
  > - **Tiered Scraper Adapter** với chuỗi `SafeDirect → Jina Reader → TinyFish`: Direct scraper kết nối trực tiếp với DNS pinning và SSRF guard; nếu gặp Cloudflare/anti-bot thì tự động fallback sang Jina hoặc TinyFish mà không tạo dữ liệu giả.
  > - **Registry Adapter** tự động tra cứu dữ liệu pháp lý chính thống từ **VietQR API** và cache cục bộ để tối ưu hiệu năng.
  > - Mọi tiến trình và phát hiện được **stream thời gian thực qua Server-Sent Events (SSE)** lên giao diện."

---

### Phút 2:00 – 3:15: Trình bày Hồ sơ & Collaboration Fit Score
- **Thao tác trên màn hình:**
  1. Cuộn xem thẻ **ProfileCard** vừa được tạo.
  2. Trỏ vào điểm **Collaboration Fit Score (Ví dụ: 88/100)**:
     - Phân tích 5 tiêu chí: *Industry Alignment (30%), Company Size (20%), Geographic Relevance (15%), Digital Maturity (15%), Recent Activity (20%)*.
  3. Trỏ vào phần **Risk Flags** và **Gợi ý Hành động Tiếp cận**.
  4. Bấm nút **"📋 Copy .md"** và **"⬇️ Tải .md"**.
- **Lời thoại:**
  > "Sau khi gom đủ dữ liệu thô, **ProfileModule** và **AnalystModule** chuyển hóa thành hồ sơ chuẩn:
  > - Tên chính thức, mã số thuế, ban lãnh đạo, sản phẩm cốt lõi và các hoạt động gần nhất.
  > - Điểm **Collaboration Fit Score** được tính toán minh bạch dựa trên 5 tiêu chí trọng số rõ ràng, không phải điểm số cảm tính.
  > - Từng thông tin đều gắn kèm **Citation** liên kết trực tiếp tới URL nguồn để thẩm định lại.
  > - Cán bộ có thể xuất ngay hồ sơ ra định dạng **Markdown** hoặc **JSON** để đẩy vào CRM của tổ chức."

---

### Phút 3:15 – 4:30: Tính năng "What Changed?" (Diff Engine)
- **Thao tác trên màn hình:**
  1. Bấm nghiên cứu lại công ty `FPT Corporation` (hoặc nhập bản cập nhật mới).
  2. Thấy hệ thống tự động so sánh với Version 1 trước đó.
  3. Phần **🔄 Thay đổi so với lần trước** hiển thị rõ:
     - Thêm mới / Thay đổi trường thông tin.
     - Phân loại mức độ quan trọng: `HIGH`, `MEDIUM`, `LOW`.
- **Lời thoại:**
  > "Điểm đặc biệt của PartnerIQ là **Diff Engine tích hợp**: Khi đối tác quay lại sau một thời gian, Agent lập tức so sánh phiên bản mới (v2) với phiên bản cũ (v1) trong cơ sở dữ liệu Supabase. Nếu có thay đổi như nhân sự chủ chốt mới hay mở rộng thị trường, Agent sẽ highlight trực quan với nhãn mức độ ưu tiên, giúp cán bộ nắm bắt biến động tức thì."

---

### Phút 4:30 – 5:00: Kiến trúc Kỹ thuật & Kết luận
- **Lời thoại:**
  > "Về mặt kỹ thuật, PartnerIQ được thiết kế theo nguyên lý **Deep Modules & Clean Seams**:
  > - **Reliable & Resilient**: Scraper 3 lớp an toàn, chống SSRF, có ngân sách trang (max 5 pages) và timeout chặt chẽ (30s).
  > - **Vendor-Agnostic**: Core hoàn toàn độc lập, dễ dàng hoán đổi OpenAI, Gemini, Serper, Jina hay TinyFish bằng cấu hình.
  > - **100% Verified**: Đã có **87 automated tests** bao phủ Unit, Security, Integration và E2E.
  >
  > PartnerIQ sẵn sàng triển khai thực tế để nâng cao năng suất tổ chức. Xin cảm ơn Ban Giám khảo!"

---

## 🧪 Demo Company Matrix (Benchmark & Smoke Test)

| Company | Input/URL / MST | Provider thắng | Duration (Scrape) | Outcome | Evidence hợp lệ |
|---|---|---|---:|---|---|
| **FPT Corporation** | `https://fpt.com.vn`<br>MST: `0101248141` | `direct` (hoặc `jina`/`tinyfish` tùy anti-bot) | ~450ms | `success` | Website title, overview, VietQR ĐKKD record |
| **Tập đoàn Vingroup** | `https://vingroup.net`<br>MST: `0101245486` | `direct` (hoặc `jina`/`tinyfish`) | ~620ms | `success` | Giới thiệu tập đoàn đa ngành, VietQR record |
| **Công ty CP MISA** | `https://misa.vn`<br>MST: `0101243150` | `direct` (hoặc `jina`/`tinyfish`) | ~510ms | `success` | Giải pháp phần mềm kế toán B2B, VietQR record |
| **Blocked URL Case** | `http://127.0.0.1`<br>`http://169.254.169.254` | `direct` | <5ms | `invalid_target` (Blocked) | Không tạo evidence giả; stream emit error |
