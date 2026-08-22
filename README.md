# PartnerIQ (TechBridgeAI) 🚀

> **AI-Powered Corporate Intelligence & Collaboration Intelligence Platform**  
> Tự động thu thập dữ liệu đa nguồn, tổng hợp hồ sơ doanh nghiệp đa phiên bản, đánh giá điểm phù hợp hợp tác (Collaboration Fit Score) và theo dõi biến động lịch sử tự động.

[![CI Pipeline](https://github.com/devonxjz/TechBridgeAI/actions/workflows/ci.yml/badge.svg)](https://github.com/devonxjz/TechBridgeAI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Next.js 16](https://img.shields.io/badge/Next.js-16%20(Turbopack)-black)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Storage-Supabase%20PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com)

---

## 🌟 Tính Năng Nổi Bật

* **Multi-source Research Pipeline:** Tự động tổng hợp thông tin từ 5 nguồn độc lập:
  * 🌐 Web Search (Google / Serper / Mock)
  * 📄 Website Scraping (TinyFish / Direct HTML extraction)
  * 📰 Tin tức kinh doanh & Báo chí (CafeF, Báo Đầu tư, VnExpress...)
  * 🏛️ Cổng thông tin Đăng ký Kinh doanh & Mã số thuế
  * 💼 Hồ sơ chuyên gia & Nhân sự chủ chốt
* **Real-time SSE Streaming:** Trực quan hóa tiến trình thu thập và phân tích dữ liệu dạng timeline real-time.
* **OpenAI Structured Profile Builder:** Tự động chuẩn hóa và trích xuất cấu trúc hồ sơ doanh nghiệp (`CompanyProfile`) với độ tin cậy và nguồn trích dẫn rõ ràng.
* **Analyst Module & Collaboration Fit Score:** Chấm điểm mức độ phù hợp hợp tác (0-100) theo 5 tiêu chí trọng số:
  * 🏢 *Industry Alignment (30%)*
  * 👥 *Company Size Match (20%)*
  * 📍 *Geographic Relevance (15%)*
  * 💻 *Digital Maturity (15%)*
  * 📈 *Recent Activity (20%)*
* **"What Changed?" Diff Engine:** So sánh tự động giữa các lần cập nhật hồ sơ, phát hiện biến động về nhân sự, ngành nghề, sản phẩm.
* **Supabase PostgreSQL Multi-Versioning:** Lưu trữ JSONB đa phiên bản với tốc độ cao và chi phí tối ưu (Free tier).
* **Báo cáo chuyên nghiệp:** Hỗ trợ Copy Markdown, Tải file `.md` và xuất dữ liệu dạng JSON.

---

## 🏗️ Kiến Trúc Hệ Thống & Sơ Đồ Kỹ Thuật (Architecture Diagrams)

### 1. Kiến Trúc Phân Lớp (Hexagonal / Ports & Adapters Architecture)

```mermaid
graph TB
  subgraph Presentation ["1. Presentation Layer (Next.js App Router)"]
    UI["React UI (Dark Glassmorphism)"]
    API["API Route: /api/research (Thin Glue & SSE)"]
  end

  subgraph CoreModules ["2. Deep Core Modules (Domain Logic)"]
    RM["ResearchModule (Multi-source Orchestrator)"]
    PM["ProfileModule (LLM Structured Builder)"]
    DE["DiffEngine (Pure Comparison Function)"]
    AM["AnalystModule (Fit Score & Action Plan)"]
  end

  subgraph Ports ["3. Ports & Seams (Interfaces)"]
    PortLLM["LLMAdapter"]
    PortSearch["SearchAdapter"]
    PortScraper["ScraperAdapter"]
    PortStorage["StorageAdapter"]
  end

  subgraph Adapters ["4. Infrastructure Adapters"]
    OpenAI["OpenAI (gpt-4o-mini) / Gemini / Mock"]
    Serper["Google Search / Serper / Mock"]
    TinyFish["TinyFish Scraper / Direct HTML / Mock"]
    Supabase["Supabase PostgreSQL (JSONB) / Memory"]
  end

  UI <-->|SSE Events / JSON| API
  API --> RM
  API --> PM
  API --> AM

  RM --> PortSearch
  RM --> PortScraper
  PM --> PortLLM
  PM --> DE
  AM --> PortLLM
  API --> PortStorage

  PortLLM --> OpenAI
  PortSearch --> Serper
  PortScraper --> TinyFish
  PortStorage --> Supabase
```

---

### 2. Luồng Xử Lý Dữ Liệu Thời Gian Thực (Data Flow & Streaming Lifecycle)

```mermaid
sequenceDiagram
  autonumber
  actor User as 👤 Người dùng
  participant Frontend as 🖥️ React UI
  participant API as ⚡ API Route (/api/research)
  participant Research as 🔍 ResearchModule (5 Sources)
  participant Profile as 🤖 ProfileModule (LLM)
  participant Storage as 🗄️ Supabase PostgreSQL
  participant Analyst as 📊 AnalystModule

  User->>Frontend: Nhập tên công ty & Bấm 'Nghiên cứu'
  Frontend->>API: POST /api/research (EventSource stream)
  API-->>Frontend: event: research:start

  loop Thu thập 5 nguồn độc lập (Timeout & Fallback Guard)
    Research->>Research: Cào Web, Tin tức, Tra cứu MST, Bóc tách Website
    Research-->>API: Yield RawFinding & Progress
    API-->>Frontend: event: research:progress & research:finding
  end

  API-->>Frontend: event: profile:building
  Profile->>Profile: Gọi OpenAI Structured Output (JSON Schema)
  Profile-->>API: CompanyProfile (v1 hoặc v2)
  
  API->>Storage: getLatestProfile(companyId)
  Storage-->>API: previousProfile (nếu có)

  alt Đã có phiên bản cũ trong DB
    Profile->>Profile: diffProfiles(current, previous)
    API->>Storage: saveDiff(diff)
    API-->>Frontend: event: diff:ready (What Changed?)
  end

  API->>Storage: saveProfile(currentProfile)
  API-->>Frontend: event: profile:ready

  API->>Analyst: analyze(profile, context)
  Analyst->>Analyst: Chấm 5 tiêu chí Fit Score, Risk Flags, Next Actions
  Analyst-->>API: AnalysisReport
  API-->>Frontend: event: analysis:ready
  API-->>Frontend: event: done
```

---

### 3. Mô Hình Lưu Trữ Đa Phiên Bản (Supabase JSONB Entity Diagram)

```mermaid
erDiagram
  COMPANY_PROFILES {
    string id PK "slugify(name), ví dụ: fpt-corporation"
    int version PK "Auto-increment: 1, 2, 3..."
    string official_name "Tên pháp lý chính thức"
    jsonb data "Toàn bộ CompanyProfile Object"
    timestamp created_at "UTC Timestamp"
    timestamp updated_at "UTC Timestamp"
  }

  COMPANY_DIFFS {
    string id PK "companyId_fromVersion_toVersion"
    string company_id FK "Liên kết ID công ty"
    int from_version "Phiên bản gốc"
    int to_version "Phiên bản đích"
    jsonb data "Danh sách FieldChange & Summary"
    timestamp created_at "UTC Timestamp"
  }

  COMPANY_PROFILES ||--o{ COMPANY_DIFFS : "tracks changes between versions"
```

---

### 4. Khung Đánh Giá Điểm Phù Hợp Hợp Tác (Collaboration Fit Score Model)

```mermaid
pie title Trọng số 5 Tiêu chí Collaboration Fit Score (Tổng 100%)
  "Industry Alignment (Ngành nghề bổ trợ)" : 30
  "Recent Activity (Hoạt động kinh doanh gần đây)" : 20
  "Company Size Match (Quy mô tổ chức phù hợp)" : 20
  "Geographic Relevance (Địa bàn & Thị trường)" : 15
  "Digital Maturity (Mức độ số hóa & Hiện diện)" : 15
```

| Tiêu chí | Trọng số | Định nghĩa đánh giá |
| :--- | :---: | :--- |
| **Industry Alignment** | **30%** | Ngành kinh doanh của đối tác có liên quan hoặc tạo giá trị cộng hưởng trực tiếp. |
| **Recent Activity** | **20%** | Các hoạt động ra mắt sản phẩm, mở rộng thị trường, gọi vốn hoặc ký kết gần đây. |
| **Company Size Match** | **20%** | Quy mô nhân sự và thị phần có cân xứng với năng lực hợp tác. |
| **Geographic Relevance** | **15%** | Mức độ bao phủ thị trường (Việt Nam, Khu vực Đông Nam Á, Toàn cầu). |
| **Digital Maturity** | **15%** | Mức độ ứng dụng công nghệ, chất lượng website, kênh truyền thông số. |

---

## 🚀 Cài Đặt & Chạy Cục Bộ

### 1. Clone repository
```bash
git clone https://github.com/devonxjz/TechBridgeAI.git
cd TechBridgeAI
```

### 2. Cài đặt dependencies
```bash
npm install
```

### 3. Cấu hình file môi trường
Tạo file `.env.local` từ mẫu `.env.example`:
```bash
cp .env.example .env.local
```

Điền các thông số API:
```env
# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Search
SEARCH_PROVIDER=mock      # mock | serper

# Scraper
SCRAPER_PROVIDER=tinyfish # tinyfish | mock
TINYFISH_API_KEY=sk-tinyfish-...

# Storage Provider — Supabase PostgreSQL
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### 4. Khởi tạo Cơ sở dữ liệu Supabase
Chạy đoạn mã SQL trong file [`supabase/schema.sql`](supabase/schema.sql) tại **SQL Editor** trên Supabase Dashboard.

### 5. Khởi chạy Development Server
```bash
npm run dev
```
Truy cập [http://localhost:3000](http://localhost:3000) trên trình duyệt.

---

## 🧪 Kiểm Thử (Testing)

Chạy bộ kiểm thử tự động với Vitest (10 test suites, 39 tests Unit, Integration & E2E):
```bash
npm test
```

Kiểm tra định kiểu TypeScript:
```bash
npx tsc --noEmit
```

Build production:
```bash
npm run build
```

---

## 📄 License
Dự án được phân phối dưới giấy phép [MIT](LICENSE).
