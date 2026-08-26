# PartnerIQ (TechBridgeAI) 🚀

> **AI-Powered Corporate Intelligence & Collaboration Fit Platform**  
> Nền tảng thẩm định doanh nghiệp thông minh: Tự động thu thập dữ liệu đa nguồn từ Internet, chuẩn hóa hồ sơ 360° qua LLM, chấm điểm tiềm năng hợp tác kinh doanh (Fit Score), nhận diện biến động theo thời gian và xuất báo cáo PDF One-Pager chuyên nghiệp.

[![CI Pipeline](https://github.com/devonxjz/TechBridgeAI/actions/workflows/ci.yml/badge.svg)](https://github.com/devonxjz/TechBridgeAI/actions/workflows/ci.yml)
[![Tests Passing](https://img.shields.io/badge/Tests-27%20Suites%20%7C%20207%20Passed-success?logo=vitest)](https://vitest.dev/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16%20(Turbopack)-black?logo=next.js)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/Orchestration-LangGraph%20v1.4-blue?logo=langchain)](https://langchain.com/)
[![LangChain](https://img.shields.io/badge/Framework-LangChain-1C3C3C?logo=langchain)](https://langchain.com/)
[![OpenAI](https://img.shields.io/badge/LLM-OpenAI%20gpt--4o--mini-412991?logo=openai)](https://openai.com/)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com)
[![Langfuse](https://img.shields.io/badge/Observability-Langfuse%20Cloud-orange)](https://langfuse.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## 🖼️ Kiến Trúc Hệ Thống (System Architecture)

<div align="center">
  <img src="./public/architecture-light.png" alt="PartnerIQ System Architecture Overview" width="100%" style="border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.08);" />
  <p><em>Kiến trúc tổng thể hệ sinh thái PartnerIQ — Quy trình thu thập đa nguồn, điều phối LangGraph, xử lý AI, lưu trữ Supabase và xuất bản báo cáo.</em></p>
</div>

---

## 💡 PartnerIQ Là Gì? (Dành Cho Người Mới Bắt Đầu)

Khi bạn muốn hợp tác với một đối tác hoặc doanh nghiệp mới, bạn thường mất hàng giờ tìm kiếm thông tin trên Google, tra cứu mã số thuế, đọc tin tức và phân tích rủi ro. **PartnerIQ tự động hóa toàn bộ quy trình này chỉ trong 3 bước đơn giản:**

```text
 1. Nhập thông tin       2. AI thu thập & phân tích       3. Nhận báo cáo toàn diện
┌────────────────┐     ┌────────────────────────────┐     ┌────────────────────────────┐
│ Tên công ty    │ ──► │ • Quét 5 nguồn độc lập     │ ──► │ • Hồ sơ 360° + Bằng chứng  │
│ (hoặc MST/Web) │     │ • Xử lý qua LangGraph & AI │     │ • Điểm Fit Score (0-100)   │
└────────────────┘     │ • Kiểm tra Cache Supabase  │     │ • Tải file PDF 1 trang     │
                       └────────────────────────────┘     └────────────────────────────┘
```

---

## ⏱️ Sơ Đồ Trình Tự Thực Thi (Execution Sequence Diagram)

<div align="center">
  <img src="./public/sequence-diagram-light.png" alt="PartnerIQ Execution Sequence Diagram" width="100%" style="border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.08);" />
  <p><em>Sơ đồ trình tự xử lý dữ liệu thời gian thực — Từ lúc người dùng gửi yêu cầu, kiểm tra cache, thu thập 5 nguồn song song, tổng hợp AI đến lưu trữ Supabase và xuất báo cáo PDF.</em></p>
</div>

---

## 🔄 Sơ Đồ Quy Trình Điều Phối (LangGraph StateGraph Workflow)

Dưới đây là sơ đồ chi tiết toàn bộ các **Node** và **Edge** trong đồ thị LangGraph điều phối quá trình nghiên cứu:

```mermaid
flowchart TD
    Start([🚀 Bắt Đầu]) --> InputNode[📥 1. Nhận yêu cầu: Company Input]
    
    InputNode --> CacheCheck{🔍 Kiểm tra Cache?}
    CacheCheck -- Cache Hit --> ReturnCache[⚡ Trả về Snapshot Cache có sẵn]
    CacheCheck -- Cache Miss / Bypass --> FanOut[🔀 Điều phối song song 5 nguồn]

    subgraph SourcesGroup [🌐 5 Nguồn Thu Thập Dữ Liệu Độc Lập]
        direction TB
        S1["🔍 web_search<br/><i>(Google Search qua Serper API)</i>"]
        S2["🌐 website<br/><i>(Scraper 3 cấp: Direct ➔ Jina ➔ TinyFish)</i>"]
        S3["📰 news<br/><i>(Tin tức báo chí CafeF, VnExpress, Vietstock)</i>"]
        S4["🏛️ registry<br/><i>(Tra cứu Cổng ĐKKD & VietQR theo MST)</i>"]
        S5["💼 linkedin<br/><i>(Thu thập thông tin nhân sự ban lãnh đạo)</i>"]
    end

    FanOut --> S1
    FanOut --> S2
    FanOut --> S3
    FanOut --> S4
    FanOut --> S5

    S1 --> EvidenceNode[📑 2. prepare_evidence<br/><i>Lọc dữ liệu & Bọc thẻ an toàn</i>]
    S2 --> EvidenceNode
    S3 --> EvidenceNode
    S4 --> EvidenceNode
    S5 --> EvidenceNode

    EvidenceNode --> ProfileNode[🧠 3. build_profile<br/><i>LLM tổng hợp hồ sơ chuẩn hóa 360°</i>]
    
    ProfileNode --> DiffNode[🔄 4. build_diff<br/><i>So sánh thay đổi với phiên bản cũ</i>]
    
    DiffNode --> AnalyzeNode[📊 5. analyze<br/><i>Chấm điểm FitScore 0-100 & Rủi ro</i>]
    
    AnalyzeNode --> PersistNode[🗄️ 6. persist_snapshot<br/><i>Lưu trữ Snapshot vào Supabase</i>]
    
    PersistNode --> StreamOutput[⚡ 7. SSE Streaming & Cập nhật Dashboard]
    
    StreamOutput --> PDFExport[📄 8. Xuất Báo Cáo PDF One-Pager A4]
    
    ReturnCache --> StreamOutput
    PDFExport --> End([🏁 Hoàn Thành])

    classDef startEnd fill:#3B82F6,stroke:#1D4ED8,stroke-width:2px,color:#fff;
    classDef nodeStyle fill:#F3F4F6,stroke:#9CA3AF,stroke-width:1.5px,color:#111827;
    classDef sourceStyle fill:#ECFDF5,stroke:#10B981,stroke-width:1.5px,color:#065F46;
    classDef aiStyle fill:#EEF2FF,stroke:#6366F1,stroke-width:1.5px,color:#3730A3;
    classDef dbStyle fill:#FDF4FF,stroke:#D946EF,stroke-width:1.5px,color:#701A75;

    class Start,End startEnd;
    class InputNode,EvidenceNode,StreamOutput,PDFExport,ReturnCache nodeStyle;
    class S1,S2,S3,S4,S5 sourceStyle;
    class ProfileNode,DiffNode,AnalyzeNode aiStyle;
    class PersistNode dbStyle;
```

---

## 🌟 5 Nguồn Dữ Liệu Hoạt Động Như Thế Nào?

1. **🔍 Tìm kiếm web (`web_search`):** Sử dụng Serper Google Search API để tìm kiếm các bài viết, hồ sơ doanh nghiệp mới nhất trên Internet.
2. **🌐 Website công ty (`website`):** Trích xuất nội dung trang chủ và các trang giới thiệu (`/about`, `/products`), tự động bảo vệ trước các liên kết độc hại qua cơ chế **Safe Tiered Scraper (Direct ➔ Jina Reader ➔ TinyFish)**.
3. **📰 Tin tức truyền thông (`news`):** Quét các trang báo chí tài chính hàng đầu (CafeF, VnExpress, Vietstock, Báo Đầu tư) để phát hiện sự kiện nổi bật và dấu hiệu rủi ro.
4. **🏛️ Đăng ký kinh doanh (`registry`):** Tra cứu dữ liệu định danh pháp lý chính thức từ Cổng đăng ký doanh nghiệp quốc gia và VietQR qua Mã số thuế.
5. **💼 Mạng lưới nhân sự (`linkedin`):** Khám phá cấu trúc lãnh đạo, nhân sự cốt cán và quy mô đội ngũ.

---

## 📊 Tiêu Chí Đánh Giá Điểm Hợp Tác (Collaboration Fit Score 0–100)

Hệ thống chấm điểm doanh nghiệp dựa trên **5 tiêu chí chuẩn hóa**:

* 🏢 **Phù hợp ngành nghề (Industry Alignment - 30%):** Đánh giá sự tương đồng trong lĩnh vực hoạt động.
* 👥 **Tương thích quy mô (Company Size Match - 20%):** Đánh giá năng lực tiếp nhận và quy mô nhân sự.
* 📍 **Vị trí địa lý (Geographic Relevance - 15%):** Khả năng triển khai thuận lợi theo vùng miền.
* 💻 **Mức độ số hóa (Digital Maturity - 15%):** Đánh giá mức độ ứng dụng công nghệ và hiện diện trực tuyến.
* 📈 **Hoạt động gần đây (Recent Activity - 20%):** Các dự án mới, sự kiện mở rộng hoặc phát triển trong 6–12 tháng qua.

> **Tính năng Bằng chứng thực tế (Real-world Evidence):** Người dùng có thể click vào bất kỳ thẻ thông tin nào trên giao diện (Tiêu chí FitScore, Rủi ro, Nhân sự, Mã số thuế, Trụ sở...) để mở tab mới kiểm chứng ngay dữ liệu từ nguồn gốc!

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Nhanh (Quick Start)

### 1. Yêu cầu hệ thống
* **Node.js**: Phiên bản `>= 18.17.0` (khuyến nghị Node 20 LTS hoặc Node 24).
* **NPM / PNPM**.

### 2. Cài đặt các gói phụ thuộc
```bash
git clone https://github.com/devonxjz/TechBridgeAI.git
cd TechBridgeAI
npm install
```

### 3. Cấu hình biến môi trường
Tạo file `.env.local` từ file mẫu:
```bash
cp .env.example .env.local
```

Điền các khóa API cơ bản:
```dotenv
# LLM Provider
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Search Provider
SEARCH_PROVIDER=serper
SERPER_API_KEY=...

# Storage (Supabase hoặc Memory)
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Langfuse Observability (Tùy chọn)
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

### 4. Khởi chạy ứng dụng
```bash
npm run dev
```
Truy cập [http://localhost:3000](http://localhost:3000) trên trình duyệt để sử dụng.

### 5. Kiểm thử hệ thống
```bash
npm run test        # Chạy toàn bộ 27 test suites với Vitest
npm run lint        # Kiểm tra chuẩn mã nguồn ESLint
npm run typecheck   # Kiểm tra kiểu TypeScript
npm run build       # Biên dịch production build với Turbopack
```

---

## 📄 Giấy Phép & Bản Quyền (License)

Dự án được phân phối dưới giấy phép **[MIT License](LICENSE)**.  
Phát triển bởi đội ngũ **PartnerIQ / TechBridgeAI**.
