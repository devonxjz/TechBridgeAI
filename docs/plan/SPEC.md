**Plan tổng thể: Company Intelligence Agent (#4)**

### 1. Vấn đề & Mục tiêu

**Pain point của sponsor**  
Mỗi lần doanh nghiệp đối tác quay lại hoặc cần làm việc, cán bộ phải:
- Tìm lại website, LinkedIn, cổng đăng ký kinh doanh, tin tức…
- Tổng hợp thủ công thành hồ sơ
- Không biết thông tin nào đã thay đổi so với lần trước
→ Tốn thời gian, dễ thiếu sót, không có “bộ nhớ tổ chức”.

**Mục tiêu sản phẩm**  
Xây **AI Research Agent** tự động tạo + cập nhật hồ sơ doanh nghiệp thông minh, có khả năng:
1. Tự nghiên cứu đa nguồn
2. Chuẩn hóa & deduplicate entity
3. So sánh thay đổi theo thời gian
4. Đánh giá tiềm năng hợp tác
5. Xuất hồ sơ chuẩn + gợi ý hành động

### 2. Solution Overview

**Tên sản phẩm đề xuất**: **PartnerIQ** (hoặc Company Intelligence Agent)

**Luồng chính**:
```
Input (tên công ty / website / mã số thuế / danh thiếp)
          ↓
   Research Agent (Gemini)
          ↓
┌─────────┼─────────┬──────────┬─────────┐
▼         ▼         ▼          ▼         ▼
Website  News    Registry   LinkedIn  Other
          ↓
   Entity Resolution + Normalization
          ↓
     Company Knowledge Graph
          ↓
   AI Analyst (Gemini)
          ↓
┌─────────┼─────────┬──────────┐
▼         ▼         ▼          ▼
Profile  Change   Fit Score  Actions
```

### 3. Core Features (MVP → Full)

| Phase | Feature | Mô tả | Ưu tiên |
|-------|---------|-------|---------|
| **MVP** | Multi-source Research | Tự động crawl/search website + news + registry + LinkedIn public | P0 |
| **MVP** | Structured Company Profile | Industry, products, markets, key people, size, recent activities… | P0 |
| **MVP** | Entity Resolution | Xử lý cùng 1 công ty nhiều tên/viết tắt | P0 |
| **MVP** | “What changed?” | So sánh profile hiện tại vs lần trước, highlight thay đổi | P0 |
| **MVP** | Export | PDF / Markdown / JSON hồ sơ đẹp | P0 |
| **V1** | Collaboration Fit Score | Đánh giá tiềm năng hợp tác dựa trên ngành + lịch sử tương tác | P1 |
| **V1** | Relationship Graph | Liên kết người – công ty – sự kiện | P1 |
| **V1** | Continuous Monitoring | Theo dõi thay đổi định kỳ, gửi alert | P1 |
| **V2** | CRM Integration | Đẩy thẳng vào hệ thống CRM của sponsor | P2 |
| **V2** | Multi-language | Hỗ trợ tốt tiếng Việt + tiếng Anh + tiếng Hàn/Nhật (nếu cần) | P2 |

### 4. Kiến trúc kỹ thuật (Google-centric)

```
Frontend (Next.js / Streamlit / AI Studio UI)
          ↓
API Gateway (Cloud Run)
          ↓
Orchestrator Agent (Gemini 2.5 / 1.5 Pro)
          ↓
┌─────────────┼─────────────┬─────────────┐
▼             ▼             ▼             ▼
Web Search   Scraper     Registry     LinkedIn
Tool         Tool        API/Scraper  Public
          ↓
Vector Store (Vertex AI / Pinecone / Chroma) + Structured DB (Firestore / PostgreSQL)
          ↓
Profile Generator + Diff Engine
```

**Công nghệ chính đề xuất**:
- **LLM**: Gemini 2.5 Flash / Pro (qua Google AI Studio + Vertex AI)
- **Orchestration**: LangGraph hoặc pure Gemini function calling / Agent
- **Search**: Google Search API / Serper / Tavily
- **Scraping**: Playwright / Firecrawl / Jina Reader
- **Storage**: Firestore (profile) + Cloud Storage (raw docs) + Vector DB
- **Deployment**: Cloud Run + Cloud Functions
- **Frontend**: Next.js hoặc giao diện trong AI Studio để demo nhanh

### 5. Data Pipeline

1. **Input** → Chuẩn hóa tên công ty (Gemini)
2. **Discovery** → Tìm website chính thức, mã số thuế, LinkedIn company page
3. **Extraction**:
   - Website: About, Products, Team, News
   - Registry (Cổng thông tin quốc gia về đăng ký doanh nghiệp)
   - News: Google News / các trang kinh tế
   - LinkedIn public (nếu có)
4. **Entity Resolution**:
   - Embedding + fuzzy matching + LLM verify
5. **Normalization** → Schema chuẩn (JSON structured)
6. **Diff** → So với version cũ trong DB
7. **Enrichment** → Fit score + gợi ý

### 6. Timeline đề xuất (giả sử 6–8 tuần thi đấu)

| Tuần | Mục tiêu | Deliverable |
|------|----------|-------------|
| 1 | Research + Architecture + Data schema | Design doc + mock data |
| 2 | Research Agent cơ bản (website + news) | Agent có thể tạo profile thô |
| 3 | Entity Resolution + Structured Profile | Profile chuẩn + export |
| 4 | Diff Engine (“What changed?”) + UI cơ bản | Demo end-to-end |
| 5 | Fit Score + Polish + Error handling | Demo mượt |
| 6 | Monitoring nhẹ + Deploy Cloud Run + Testing | Production-ready MVP |
| 7–8 | Polish demo script + edge cases + video | Final submission |

### 7. Demo Flow đề xuất (3–5 phút)

1. Nhập tên công ty (ví dụ: “FPT Corporation” hoặc công ty nhỏ hơn)
2. Agent chạy real-time → hiện progress (“Đang tìm website… Đang đọc tin tức…”)
3. Hiện profile đẹp + các nguồn đã dùng (có citation)
4. Bấm “So sánh với lần trước” → highlight thay đổi (CEO mới, sản phẩm mới, tin xấu…)
5. Hiện Collaboration Fit Score + lý do
6. Export PDF / gửi vào CRM giả lập

### 8. Thách thức & Cách xử lý

| Thách thức | Mức độ | Giải pháp |
|------------|--------|-----------|
| Website công ty nhỏ nghèo nàn | Cao | Fallback sang registry + news + LLM inference có đánh dấu “low confidence” |
| Entity resolution khó (cùng tên, viết tắt) | Trung bình-Cao | Kết hợp embedding + LLM verification + human feedback loop |
| Rate limit / blocking khi scrape | Trung bình | Dùng Jina/Firecrawl + cache + respectful crawling |
| Thông tin lỗi thời / sai | Trung bình | Luôn kèm timestamp + nguồn + confidence score |
| Privacy | Thấp-Trung bình | Chỉ dùng dữ liệu công khai, không lưu dữ liệu cá nhân nhạy cảm |
| Indirect prompt injection từ website | Trung bình-Cao | Coi scraped text là untrusted data, giữ citation/confidence; thêm prompt isolation trước public production |

**Known security limitation — indirect prompt injection:** Nội dung lấy từ website đi vào LLM để dựng profile và có thể chứa chỉ thị độc hại. Structured output chỉ ép đúng schema, không bảo đảm các giá trị trong schema là đúng. Trước khi public production, system prompt phải nói rõ scraped content là dữ liệu, không phải hướng dẫn; từng finding cần được đặt trong delimiter/data block và kiểm thử bằng nội dung đối kháng. Đây là defense-in-depth, không phải biện pháp loại bỏ hoàn toàn prompt injection.

### 9. Success Metrics (cho cuộc thi + production)

**Cuộc thi**:
- Demo mượt, không lỗi trong 5 phút
- Có citation + timestamp rõ ràng
- Feature “What changed?” hoạt động tốt
- Architecture agentic rõ (không phải chatbot đơn giản)

**Production**:
- Thời gian tạo hồ sơ < 60–90 giây
- Accuracy entity resolution > 90%
- Người dùng tiết kiệm ≥ 70% thời gian research thủ công
- Tỷ lệ hồ sơ được sử dụng lại / cập nhật cao

---

**Tóm tắt kế hoạch**  
PartnerIQ là sản phẩm **thực tế cao**, dễ build MVP mạnh trong thời gian cuộc thi, và có đường đi production rõ ràng vì dựa chủ yếu vào dữ liệu công khai.

Bạn muốn mình đi sâu tiếp phần nào trước?
1. Chi tiết Architecture + prompt design
2. Data schema + ví dụ profile JSON
3. Roadmap kỹ thuật tuần 1–2 (code structure)
4. Demo script chi tiết
5. Hoặc bắt đầu thiết kế UI/UX wireframe
