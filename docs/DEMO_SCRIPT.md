# PartnerIQ — Demo Script (3-5 Phút)

> Kịch bản trình diễn sản phẩm Company Intelligence Agent tại Google AI Hackathon 2026.

---

## 🎬 Mục tiêu Demo
Chứng minh PartnerIQ giải quyết triệt để bài toán:
1. **Nghiên cứu tự động đa nguồn** (Web, Website, Tin tức, Đăng ký kinh doanh, LinkedIn).
2. **Streaming thời gian thực** (Real-time SSE progress & findings log).
3. **Tổng hợp hồ sơ chuẩn hóa** kèm trích dẫn nguồn (Citations).
4. **Phân tích Tiềm năng Hợp tác (Fit Score)** với 5 tiêu chí trọng số rõ ràng.
5. **Phát hiện thay đổi theo thời gian ("What changed?" Diff Engine)**.
6. **Xuất báo cáo đa định dạng (Markdown & JSON)**.

---

## ⏱️ Kịch bản chi tiết theo từng phút

### Phút 0:00 – 0:45: Nêu Pain Point & Giới thiệu PartnerIQ
- **Lời thoại (Talk track):**
  > "Kính chào Ban Giám khảo. Mỗi khi cần thẩm định một đối tác doanh nghiệp, cán bộ phát triển kinh doanh phải mất từ 2 đến 3 tiếng tìm kiếm thủ công trên Google, đọc tin tức, tra cứu cổng đăng ký kinh doanh và copy vào file Word. Thông tin vừa dễ thiếu sót, vừa không có cơ chế phát hiện những thay đổi quan trọng như đổi CEO, tăng vốn hay có tin xấu pháp lý.
  >
  > Hôm nay, chúng tôi giới thiệu **PartnerIQ** — AI Research Agent tự động hóa toàn bộ quy trình nghiên cứu, chuẩn hóa hồ sơ và đánh giá tiềm năng hợp tác cho doanh nghiệp Việt Nam chỉ trong 60 giây."

---

### Phút 0:45 – 2:00: Demo Luồng Nghiên cứu Real-time
- **Thao tác trên màn hình:**
  1. Mở giao diện PartnerIQ tại `http://localhost:3000`.
  2. Nhập:
     - **Tên công ty:** `FPT Corporation`
     - **Website:** `https://fpt.com.vn` (hoặc để trống để Agent tự khám phá).
  3. Bấm **"🔍 Bắt đầu nghiên cứu"**.
- **Lời thoại & Điểm nhấn:**
  > "Ngay khi bấm bắt đầu, hệ thống kích hoạt **ResearchModule** kết nối song song các Adapter:
  > - **Web Search Adapter** tìm kiếm các từ khóa tiếng Việt tối ưu.
  > - **Scraper Adapter** trích xuất sâu trang chủ và các subpage `/about`, `/products`.
  > - **Registry Adapter** tự động tra cứu mã số thuế qua cơ chế fallback 3 cấp.
  > - Mọi tiến trình và phát hiện được **stream thời gian thực qua Server-Sent Events (SSE)** lên giao diện, người dùng theo dõi được ngay mà không cần chờ đợi màn hình trắng."

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
  > "Điểm đặc biệt của PartnerIQ là **Diff Engine tích hợp**: Khi đối tác quay lại sau 6 tháng, Agent lập tức so sánh phiên bản mới (v2) với phiên bản cũ (v1) trong Firestore. Nếu có thay đổi như nhân sự chủ chốt mới hay mở rộng thị trường, Agent sẽ highlight trực quan với nhãn mức độ ưu tiên, giúp cán bộ nắm bắt biến động tức thì."

---

### Phút 4:30 – 5:00: Kiến trúc Kỹ thuật & Kết luận
- **Lời thoại:**
  > "Về mặt kỹ thuật, PartnerIQ được thiết kế theo nguyên lý **Deep Modules & Clean Seams**:
  > - **Vendor-Agnostic**: Core hoàn toàn độc lập, dễ dàng hoán đổi OpenAI, Gemini 2.5 Flash hay Claude chỉ bằng 1 biến môi trường.
  > - **Fault-Tolerant**: Khả năng chịu lỗi nguồn cào dữ liệu độc lập với cơ chế circuit breaker và timeout.
  > - Đã có **37 tests tự động** bao phủ từ Unit, Integration tới E2E.
  >
  > PartnerIQ sẵn sàng triển khai thực tế trên Google Cloud Run để nâng cao năng suất tổ chức. Xin cảm ơn Ban Giám khảo!"

---

## 🧪 Danh sách Doanh nghiệp Mẫu để Test Demo

| STT | Tên Doanh nghiệp | Website | Mục đích test |
| :---: | :--- | :--- | :--- |
| 1 | **FPT Corporation** | `https://fpt.com.vn` | Test công ty công nghệ lớn, nhiều dữ liệu, ban lãnh đạo rõ ràng |
| 2 | **Tập đoàn Vingroup** | `https://vingroup.net` | Test tập đoàn đa ngành, nhiều mảng kinh doanh và thị trường quốc tế |
| 3 | **Công ty Cổ phần MISA** | `https://misa.vn` | Test doanh nghiệp phần mềm B2B Việt Nam |
| 4 | **Startup Test (để trống website)** | — | Test khả năng tự động tìm kiếm và khám phá website của Agent |
