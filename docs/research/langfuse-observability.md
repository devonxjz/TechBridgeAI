# Langfuse observability cho PartnerIQ

> Ngày nghiên cứu: 2026-08-25
>
> Phạm vi nguồn: chỉ tài liệu/repository/package chính thức của Langfuse và OpenTelemetry
>
> Trạng thái: đề xuất cấu hình, chưa sửa mã nguồn
>
> Baseline SDK: Langfuse JS/TS v5, các package `@langfuse/*` hiện ở `5.10.1`

## 1. Kết luận ngắn

PartnerIQ nên dùng Langfuse JS/TS SDK v5 trực tiếp trên workflow hiện có, không thêm LangChain/LangGraph chỉ để lấy tracing. SDK hiện hành là dòng package scoped `@langfuse/*`; package `@langfuse/tracing` 5.10.1 cung cấp `startObservation`, `startActiveObservation`, `observe()` và `propagateAttributes`, còn prompt/dataset/score thuộc `@langfuse/client` 5.10.1. Package unscoped `langfuse` là SDK v3 cũ và không nên dùng cho tích hợp mới. ([npm: `@langfuse/tracing`](https://www.npmjs.com/package/%40langfuse/tracing), [npm: `@langfuse/client`](https://www.npmjs.com/package/%40langfuse/client))

Đường triển khai ngắn nhất:

1. Khởi tạo một `LangfuseSpanProcessor` ở startup Node.js.
2. Tạo một root observation `partneriq.research` bên trong async IIFE đang chạy pipeline SSE.
3. Tạo span con cho research/profile/diff/analyst và từng source.
4. Bọc OpenAI client hiện có bằng `observeOpenAI` để tự thu prompt, completion, token, cost, error và latency.
5. Propagate `userId`, `sessionId`, `version`, tags và metadata ngay đầu root scope.
6. Mask trước khi export; không gửi raw scraped page nếu chỉ cần số lượng, URL và summary đã lọc.
7. Giữ sampling 100% cho quy mô demo hiện tại; flush một lần sau khi root đã kết thúc.

Langfuse JS/TS tracing dựa trên OpenTelemetry, nối context qua async workload và đo thời gian bằng timestamp đồng bộ; SDK gửi dữ liệu bất đồng bộ và bắt lỗi nội bộ để không làm hỏng ứng dụng. ([SDK overview](https://langfuse.com/docs/observability/sdk/overview))

## 2. Bối cảnh PartnerIQ đã xác nhận

- Stack hiện tại: Next.js 16.3.2 App Router, TypeScript, Node.js; máy nghiên cứu chạy Node 24.18.0.
- `/src/app/api/research/route.ts` trả SSE rồi chạy pipeline trong một async IIFE.
- `/src/modules/research/index.ts` hiện chạy các source **tuần tự**, không chạy parallel: web search → website → news → registry → LinkedIn nếu có URL.
- `/src/adapters/llm/openai.ts` là điểm tập trung của toàn bộ OpenAI calls; profile và analyst đều dùng adapter này.
- Prompt profile/analyst đang hard-code trong source; chưa có Langfuse, LangChain hoặc LangGraph trong dependencies.
- Lưu ý phạm vi: tài liệu này vẫn mô tả propagation cho parallel worker để sẵn sàng nếu research sources được đổi sang `Promise.all`, worker thread, queue hoặc LangGraph sau này.

### Hệ quả kiến trúc quan trọng

Không nên wrap riêng hàm `POST` rồi kết thúc root span khi `Response` được trả về: `POST` trả về trước khi background IIFE hoàn tất, nên trace sẽ đo sai latency và có thể để các bước sau thành orphan. Root observation phải được mở và đóng **bên trong IIFE**, bao trọn research → profile → diff → analyst → persist.

## 3. Version và package baseline

Tại ngày 2026-08-25, npm chính thức hiển thị `@langfuse/tracing` và `@langfuse/client` ở 5.10.1; Langfuse gọi đây là SDK generation hiện hành. ([npm tracing](https://www.npmjs.com/package/%40langfuse/tracing), [npm client](https://www.npmjs.com/package/%40langfuse/client)) `@langfuse/langchain` cũng ở 5.10.1. ([npm LangChain integration](https://www.npmjs.com/package/%40langfuse/langchain?activeTab=versions))

Baseline đề xuất nếu triển khai:

| Package | Vai trò | Có cần ngay? |
|---|---|---:|
| `@langfuse/tracing@5.10.1` | Custom observations, context, attribute propagation | Có |
| `@langfuse/otel@5.10.1` | `LangfuseSpanProcessor` export OTel spans | Có |
| `@opentelemetry/sdk-node` | Node SDK/provider/context | Có |
| `@langfuse/openai@5.10.1` | Wrap OpenAI SDK hiện tại | Có |
| `@langfuse/client@5.10.1` | Prompt management, scores, datasets/experiments | Chỉ khi mở prompt/eval |
| `@langfuse/langchain@5.10.1` | LangChain/LangGraph callback | Không, trừ khi app thực sự dùng framework |

`@langfuse/otel` yêu cầu Node.js ≥20; tài liệu SDK phân loại processor này là Node-only, trong khi các package client/tracing/integration có phần universal. ([SDK package matrix](https://langfuse.com/docs/observability/sdk/overview#install-the-sdk)) PartnerIQ hiện đáp ứng yêu cầu Node, nhưng route instrumented không nên chuyển sang Edge runtime.

Rủi ro version:

- SDK v5 đổi sang observations-first model và có smart default filtering: mặc định export Langfuse spans, spans có `gen_ai.*`, và một số instrumentation scope LLM đã biết. Custom `shouldExportSpan` là full override; loại nhầm parent/intermediate span có thể làm cây trace đứt. ([v4 → v5 migration](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5))
- Pin cùng một patch line cho các `@langfuse/*` package và nâng cấp có kiểm thử; integration LangChain/LangGraph được chính Langfuse cảnh báo là đang phát triển tích cực và có upgrade paths riêng. ([LangChain integration](https://langfuse.com/integrations/frameworks/langchain#upgrade-paths-for-langchain-integration))
- Nếu self-host, JS/TS SDK v4/v5 cần server tối thiểu 3.63.0 cho bộ tính năng được tài liệu hiện hành liệt kê. ([SDK compatibility requirement](https://langfuse.com/docs/observability/sdk/overview#requirements-for-self-hosted-langfuse)) Trên v4 data model, dữ liệu từ JS SDK <5.4.0 hoặc OTel exporter không gửi ingestion header v4 có thể chậm đến 15 phút ở API v2; 5.10.1 tránh nhánh rủi ro này. ([compatibility matrix](https://langfuse.com/docs/compatibility))

## 4. Trace/observation hierarchy đề xuất

Langfuse hiện tổ chức dữ liệu theo ba tầng: observations thuộc một trace qua `trace_id`, và nhiều trace có thể thuộc một session qua `session_id`. Trace-level attributes trong observations-first model được lặp trên mọi observation để query nhanh. ([data model](https://langfuse.com/docs/observability/data-model))

```text
trace: partneriq.research
└─ agent: partneriq.workflow                  # root observation
   ├─ chain: research.collect
   │  ├─ tool: source.web_search
   │  ├─ tool: source.website
   │  │  ├─ tool: search.discovery            # chỉ nếu cần drill-down
   │  │  └─ tool: scrape.page                 # aggregate, không 1 span/chunk
   │  ├─ tool: source.news
   │  ├─ tool: source.registry
   │  └─ tool: source.linkedin                # khi có URL
   ├─ chain: profile.build
   │  └─ generation: openai.chat.completions  # tự sinh bởi observeOpenAI
   ├─ span: profile.persist
   ├─ span: profile.diff                      # khi có previous profile
   ├─ chain: analyst.analyze
   │  └─ generation: openai.chat.completions
   └─ span: analysis.persist                  # chỉ khi app thực sự persist report
```

Các observation type hiện gồm generic span và các loại chuyên biệt như `agent`, `chain`, `tool`, `generation`, `embedding`, `retriever`, `guardrail`; type đúng giúp UI/agent graph và metric có nghĩa hơn. ([observation types](https://langfuse.com/docs/observability/features/observation-types)) Chỉ observation loại `generation` và `embedding` mang usage/cost, vì vậy không ghi LLM call thành generic span. ([token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking))

### Quy tắc granularity

- Một research job = một trace.
- Một source attempt = một `tool` observation, kể cả timeout/failure.
- Một LLM API call = một `generation` observation.
- Không tạo một span cho mỗi SSE event, token chunk hoặc finding; số lượng và trạng thái là metadata/output của span source.
- Root input/output nên là payload business đã tối giản: input company identity và output profile/report summary, không phải toàn bộ raw pages.
- `startActiveObservation` tự đặt observation làm active trong callback và tự end qua async boundaries; nesting dựa vào OTel context. `startObservation` không đổi active context và bắt buộc `.end()` thủ công. ([instrumentation patterns](https://langfuse.com/docs/observability/sdk/instrumentation#custom-instrumentation))

## 5. Cấu hình JS/TS tối thiểu

Đây là blueprint, không phải thay đổi đã áp dụng:

```ts
// instrumentation.ts (conceptual)
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  mask: ({ data }) => redactPartnerIqTelemetry(data),
});

export const telemetrySdk = new NodeSDK({
  spanProcessors: [langfuseSpanProcessor],
});

telemetrySdk.start();
```

Langfuse yêu cầu khởi tạo OTel trước logic cần trace; với framework có startup order phức tạp như Next.js, một instrumentation file là điểm khởi tạo dễ dự đoán. ([get started](https://langfuse.com/docs/observability/get-started)) Environment tối thiểu:

```dotenv
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://jp.cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=production
LANGFUSE_LOG_LEVEL=WARN
```

EU default là `https://cloud.langfuse.com`; Cloud hiện có region US, EU, Japan và HIPAA, tách biệt hoàn toàn về account/data/infrastructure. Chuyển region cần account mới và migration dữ liệu. ([Cloud data regions](https://langfuse.com/security/data-regions)) Chọn Japan cho latency gần Việt Nam chỉ là giả định vận hành; data-residency/compliance phải được chủ dự án xác nhận trước khi dùng production.

### Blueprint cho root scope

```ts
await startActiveObservation(
  "partneriq.workflow",
  async (root) => {
    root.update({ input: sanitizedCompanyInput });

    await propagateAttributes(
      {
        traceName: "partneriq.research",
        userId,
        sessionId,
        version: appVersion,
        tags: ["workflow:research", "surface:sse"],
        metadata: {
          researchRunId,
          companyId,
          requestedSources,
        },
      },
      async () => {
        // Existing research/profile/diff/analyst pipeline.
      },
    );

    root.update({ output: sanitizedResultSummary });
  },
  { asType: "agent" },
);
```

Trong v5, `propagateAttributes` phải chạy sớm để `userId`, `sessionId`, `version`, tags, metadata và trace name xuất hiện trên mọi observation; values phải là string ≤200 ký tự, metadata keys chỉ alphanumeric, và invalid values bị drop kèm warning. ([attribute propagation](https://langfuse.com/docs/observability/sdk/instrumentation#add-attributes-to-observations)) `setTraceIO()` đã deprecated; input/output tổng thể nên đặt trực tiếp trên root observation. ([v5 trace I/O](https://langfuse.com/docs/observability/sdk/instrumentation#update-trace))

## 6. Propagation qua parallel source và worker

### 6.1 Cùng Node process/event loop

Nếu sau này `ResearchModule` đổi sang `Promise.all`, mọi branch được tạo và `await` bên trong `startActiveObservation`/`propagateAttributes` scope sẽ kế thừa OTel context qua async boundaries. ([Langfuse nesting](https://langfuse.com/docs/observability/sdk/instrumentation#nesting-observations), [OpenTelemetry JS context](https://opentelemetry.io/docs/languages/js/context/)) Mỗi branch phải tự mở một active `tool` observation; phải `await` toàn bộ branches trước khi root callback trả về để parent không end sớm.

Không chia sẻ một mutable span handle để nhiều branch cùng update output. Mỗi source cập nhật span của chính nó, sau đó root/research span chỉ ghi aggregate counts.

### 6.2 Worker thread, queue hoặc process/service khác

Async context không tự đi qua custom message/queue boundary. OpenTelemetry quy định inject active context vào carrier ở phía gửi và extract carrier ở phía nhận; W3C `traceparent`/`tracestate` nối trace và parent-child relationship qua process/network. ([OTel JS propagation](https://opentelemetry.io/docs/languages/js/propagation/)) Langfuse dùng W3C Trace Context, với trace ID 32 hex chars và observation/span ID 16 hex chars. ([trace IDs](https://langfuse.com/docs/observability/sdk/instrumentation#trace-and-observation-ids))

```text
orchestrator
  propagation.inject(context.active(), job.headers)
        │  traceparent + tracestate
        ▼
worker
  parent = propagation.extract(context.active(), job.headers)
  context.with(parent, () => start worker/source observation)
```

Nếu dùng API Langfuse trực tiếp, `parentSpanContext` có thể link observation vào trace hiện hữu; tuy nhiên carrier W3C qua OTel là lựa chọn chuẩn cho distributed execution. ([link existing traces](https://langfuse.com/docs/observability/sdk/instrumentation#trace-and-observation-ids))

`propagateAttributes({ asBaggage: true })` có thể đưa user/session attributes qua HTTP headers, nhưng Langfuse cảnh báo baggage xuất hiện trên mọi outbound request; chỉ dùng ID không nhạy cảm, không đưa email, tax ID, prompt, token hoặc raw metadata vào baggage. ([cross-service propagation warning](https://langfuse.com/docs/observability/sdk/instrumentation#cross-service-propagation))

### 6.3 Thực trạng PartnerIQ

Hiện chưa cần worker propagation vì code đang tuần tự trong một process. Thêm worker abstraction trước khi có parallel workers là YAGNI; chỉ cần giữ contract `traceparent`/`tracestate` trong thiết kế job envelope khi thật sự tách process.

## 7. User/session/run metadata

| Trường | Giá trị PartnerIQ đề xuất | Không nên dùng |
|---|---|---|
| `traceName` | `partneriq.research` | Tên công ty động làm trace name |
| `userId` | Internal authenticated user ID hoặc stable pseudonymous ID | Email/số điện thoại |
| `sessionId` | UI/research conversation ID; với LangGraph là `thread_id` | Mỗi span một session mới |
| `version` | App release/commit/deployment ID | Profile version business |
| `tags` | `workflow:research`, `surface:sse`, `mode:demo` | High-cardinality IDs |
| metadata `researchRunId` | UUID của job | Dùng thay trace ID |
| metadata `companyId` | Internal slug/ID đã kiểm tra PII policy | Raw full input object |
| metadata `profileVersion` | Phiên bản hồ sơ | Nhét vào SDK `version` |
| metadata `requestedSources` | Danh sách source ngắn | Raw URLs lớn |
| source span metadata | `source`, `attempt`, `timeoutMs`, `findingCount`, `retryable` | Full scraped content |

User ID mở khóa per-user views; session nhóm nhiều traces trong một thread/conversation; tags và metadata hỗ trợ filter/aggregation. ([best practices](https://langfuse.com/docs/observability/best-practices), [data model](https://langfuse.com/docs/observability/data-model)) Environment nên cấu hình toàn process qua `LANGFUSE_TRACING_ENVIRONMENT`; tên environment bị giới hạn lowercase/numbers/hyphen/underscore và tối đa 40 ký tự. ([environments](https://langfuse.com/docs/observability/features/environments))

`researchRunId` nên ở metadata và cũng có thể được trả về SSE cùng trace ID để tìm nhanh trong UI. Không cần ép trace ID bằng run ID trừ khi có integration ngoài yêu cầu deterministic correlation; Langfuse có `createTraceId(seed)` cho trường hợp đó. ([deterministic trace ID](https://langfuse.com/docs/observability/sdk/instrumentation#trace-and-observation-ids))

## 8. OpenAI instrumentation, token, cost và latency

PartnerIQ đã có một `OpenAIAdapter`, vì vậy thay client bên trong adapter bằng `observeOpenAI(new OpenAI(...))` là điểm instrument duy nhất và nhỏ nhất. Wrapper chính thức tự thu prompts/completions, streaming/function calls, total latency, time-to-first-token, OpenAI errors, token usage và USD cost. ([OpenAI JS/TS integration](https://langfuse.com/integrations/model-providers/openai-js))

Không tạo thêm manual `generation` quanh cùng một wrapped OpenAI call; nếu làm cả hai sẽ có duplicate/nested generations và cost bị đếm khó hiểu. Manual spans chỉ bao các module business; wrapper sinh generation bên trong active module span.

### Usage/cost

- Integrations thường tự capture usage; Langfuse dùng model name + model pricing definition để infer cost khi không ingest cost trực tiếp. Ingested cost/usage được ưu tiên hơn inferred values. ([token/cost model](https://langfuse.com/docs/observability/features/token-and-cost-tracking))
- Các usage buckets phải loại trừ lẫn nhau; nếu gửi inclusive cached/reasoning tokens như buckets độc lập sẽ double-count. Wrapper chính thức normalize provider usage; manual `usageDetails` thì người gửi phải tự đảm bảo exclusive buckets. ([usage normalization](https://langfuse.com/docs/observability/features/token-and-cost-tracking#usage-types-are-mutually-exclusive-buckets))
- Reasoning models cần usage ingest vì Langfuse không thể suy ra hidden reasoning tokens chỉ từ input/output. ([reasoning model caveat](https://langfuse.com/docs/observability/features/token-and-cost-tracking#why-doesnt-langfuse-infer-cost-for-reasoning-models-like-openai-o1))
- Với OpenAI streaming, phải bật `stream_options: { include_usage: true }` để provider trả usage ở final chunk. ([OpenAI streamed usage](https://langfuse.com/integrations/model-providers/openai-js#openai-token-usage-on-streamed-responses)) Adapter stream hiện tại chưa bật option này.

### Latency

- Root latency = toàn bộ research job đến khi pipeline background xong, không phải thời gian để route trả headers SSE.
- Source span latency = search/scrape/registry attempt gồm timeout.
- Generation latency/TTFT = wrapper tự thu; TTFT chỉ có ý nghĩa với stream response. ([OpenAI JS/TS integration](https://langfuse.com/integrations/model-providers/openai-js))
- Dashboard/API có thể phân tích latency p50/p95/p99; observations API cung cấp `latency` và `timeToFirstToken`. ([events charts](https://langfuse.com/docs/observability/features/events-table-charts), [observations API field groups](https://langfuse.com/docs/api-and-data-platform/features/observations-api))

## 9. Error capture

`observe()` tự capture timing và thrown errors; OpenAI wrapper tự capture OpenAI API errors. ([custom instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation#observe-wrapper), [OpenAI integration](https://langfuse.com/integrations/model-providers/openai-js)) Langfuse observations hỗ trợ `DEBUG`, `DEFAULT`, `WARNING`, `ERROR` và `statusMessage`; LangChain integration tự gán level/status cho từng pipeline step. ([log levels](https://langfuse.com/docs/observability/features/log-levels))

PartnerIQ có một caveat: `runSourceWithTimeout` catch exception rồi trả `SourceResult`, nên outer `observe()` không thấy exception thoát ra. Source span phải được cập nhật thủ công:

- `ERROR` cho source fail/timeout.
- `statusMessage` đã redact, ngắn, không chứa response body/token/secret.
- metadata: `errorType`, `retryable`, `attempt`, `timeoutMs`.
- Root `WARNING` nếu partial success; `ERROR` nếu không có finding hoặc pipeline không tạo được result.
- Analyst failure hiện không fail toàn workflow: analyst span `ERROR`, root `WARNING`, output root ghi `analysisAvailable: false`.

Không log cùng một exception thành nhiều error observations ở mọi tầng. Source/generation ghi nguyên nhân; root chỉ ghi aggregate outcome.

## 10. Prompt/version tracking

Hiện prompt ở source code, nên baseline observability chỉ có thể gắn `version` deployment và metadata `promptName`/hash do PartnerIQ tự cung cấp. Đưa prompt sang Langfuse là phase sau, không phải điều kiện để tracing hoạt động.

Khi mở prompt management:

1. Dùng `@langfuse/client` lấy prompt theo label `production`; `latest` luôn trỏ version mới nhất nhưng không nên là mặc định production. Mỗi thay đổi tạo immutable sequential version, label là pointer và có thể rollback bằng cách chuyển `production`. ([prompt version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control))
2. Compile variables ở runtime, giữ input business ngoài prompt template. ([prompt variables](https://langfuse.com/docs/prompt-management/features/variables))
3. Truyền chính prompt object vào generation hoặc `observeOpenAI({ langfusePrompt })`; khi đã link, Langfuse aggregate latency, tokens, cost, count và scores theo exact prompt version. ([link prompts to traces](https://langfuse.com/docs/prompt-management/features/link-to-traces))
4. Giữ local system prompt hiện tại làm `fallback` cho cold instance + network/API failure. Client cache mặc định 60 giây, dùng stale prompt trong khi background revalidation; first cold fetch có thể throw nếu API không reachable và không có cache/fallback. ([prompt caching](https://langfuse.com/docs/prompt-management/features/caching), [guaranteed availability](https://langfuse.com/docs/prompt-management/features/guaranteed-availability))

Rủi ro: prompt config có thể version cả model, temperature, output schema và tools; di chuyển toàn bộ config khỏi code sẽ làm thay đổi release-control boundary. Chỉ chuyển system/user template trước; giữ schema/security controls trong code cho đến khi có quy trình review prompt rõ ràng. Prompt config chính thức là arbitrary JSON và được version cùng prompt. ([prompt config](https://langfuse.com/docs/prompt-management/features/config))

## 11. Scores và evaluation

Langfuse score có thể gắn vào trace, observation, session hoặc dataset run; type gồm Numeric, Categorical, Boolean và Text. Với observation score phải cung cấp cả trace ID và observation ID. Score có thể ingest trước trace và sẽ link khi trace cùng ID xuất hiện. ([scores via SDK/API](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk))

### Score nhỏ nhất có ích cho PartnerIQ

| Score | Target | Type | Nguồn |
|---|---|---|---|
| `source_coverage` | root trace | Numeric 0..1 | deterministic code |
| `profile_schema_valid` | `profile.build` | Boolean | Zod parse |
| `profile_confidence` | root/profile observation | Numeric 0..1 | existing calculation |
| `analysis_schema_valid` | `analyst.analyze` | Boolean | Zod parse |
| `research_success` | root trace | Categorical | `complete` / `partial` / `failed` |
| `user_helpful` | root trace | Boolean | UI feedback |

Không dùng LLM-as-a-Judge cho các check đã deterministic. Dùng LLM judge cho tiêu chí semantic như factual grounding/citation faithfulness trên một sample nhỏ. Online evaluation hiện được thiết kế bằng rule chọn incoming observations + sampling rate + evaluator; offline experiment chạy application trên dataset để so prompt/model trước deployment. ([evaluation concepts](https://langfuse.com/docs/evaluation/core-concepts), [LLM-as-a-Judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge))

Đề xuất eval:

- Offline: dataset 20–50 công ty Việt Nam có expected facts/citations; so prompt profile/analyst versions trước khi chuyển `production` label.
- Online: evaluate observation `profile.build` hoặc final customer-facing generation, không score toàn bộ trace nếu chỉ một observation cần đánh giá.
- Production sample: 5–10% cho semantic judge khi traffic tăng; deterministic checks 100%.
- User feedback frontend: dùng `@langfuse/browser` chỉ với public key; tuyệt đối không expose secret key. Backend/CI dùng `@langfuse/client`. ([browser score ingestion](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk#browser-score-ingestion))
- Score writes của `LangfuseClient` có queue riêng với tracing spans; short-lived job phải `await langfuse.flush()` cho scores, còn tracing dùng processor `forceFlush()`. ([npm client quickstart](https://www.npmjs.com/package/%40langfuse/client))

## 12. Sampling và filtering

Quy mô PartnerIQ hiện chỉ 1–2 research jobs đồng thời và demo budget thấp, nên giữ 100% traces. Sampling sớm làm mất chính các failure hiếm cần debug.

Khi volume tăng, Langfuse tôn trọng OTel sampling decision; JS/TS có thể dùng `TraceIdRatioBasedSampler`. Nếu trace bị sample out, toàn bộ observations và associated scores của trace đó không được gửi. ([sampling](https://langfuse.com/docs/observability/sdk/advanced-features#sampling))

Rủi ro:

- Head sampling không biết trace sẽ lỗi ở cuối; ratio sampling có thể bỏ error traces. Muốn giữ 100% error + sample success cần thiết kế tail sampling/collector riêng, không nên thêm cho MVP.
- `shouldExportSpan` là filtering, không phải trace-consistent sampling. Drop parent nhưng giữ child làm trace tree đứt; trước khi override hãy giữ default `isDefaultExportSpan` rồi mở rộng có kiểm thử. ([v5 smart filtering](https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5#smart-default-span-filtering-replaces-export-all-behavior))
- Không dùng isolated TracerProvider nếu chưa cần tách backend: Langfuse cảnh báo parent/child qua nhiều provider có thể orphan hoặc tạo hierarchy khó hiểu. ([isolated provider caveat](https://langfuse.com/docs/observability/sdk/advanced-features#isolated-tracerprovider))

## 13. Redaction, PII và data minimization

Ưu tiên data minimization trước regex masking:

- Không gửi raw scraped HTML/text vào root input/output.
- Source span chỉ gửi URL origin/path đã lọc, content length, finding count, HTTP status và short summary cần debug.
- Không gửi API keys, Authorization/Cookie headers, request/response headers, OpenAI client config hoặc full stack containing secrets.
- Pseudonymize `userId`; không dùng email/phone.
- Redact email, phone, personal address, access token, cookie, bearer token và trường input nhạy cảm trước export.
- Đặt maximum size cho input/output/metadata để tránh cost và UI noise; observe wrapper có thể tắt input/output capture khi payload lớn. ([observe I/O capture](https://langfuse.com/docs/observability/sdk/instrumentation#observe-wrapper))

JS/TS `LangfuseSpanProcessor` nhận `mask({ data })`; hook áp dụng lên input, output và metadata của mọi observation trước khi export. ([client-side masking](https://langfuse.com/docs/observability/sdk/advanced-features#mask-sensitive-data)) Self-hosted có thêm server-side ingestion masking callback, nhưng đây là Enterprise Edition; Langfuse khuyến nghị client-side để ngăn sensitive data rời ứng dụng và có thể dùng cả hai cho defense in depth. ([self-hosted data masking](https://langfuse.com/self-hosting/security/data-masking))

Masking hook nhận serialized JSON string, nên regex đơn thuần có thể miss Unicode/obfuscated values hoặc phá JSON semantics. Phải có test riêng cho mẫu Việt Nam và luôn giảm payload trước masking.

## 14. Next.js/serverless lifecycle

### Startup/runtime

- Khởi tạo processor trước code được trace. Langfuse khuyên instrumentation file cho Next.js/serverless/bundler startup order. ([Next.js startup guidance](https://langfuse.com/docs/observability/get-started))
- Có thể dùng `registerOTel` của `@vercel/otel` nếu version ≥2; bản trước không hỗ trợ OTel JS v2 mà Langfuse SDK dựa vào. `NodeSDK` setup cũng hoạt động và không có yêu cầu `@vercel/otel`. ([Next.js OTel setup](https://langfuse.com/docs/observability/sdk/overview#initialize-opentelemetry-jsts-only)) PartnerIQ chưa dùng `@vercel/otel`, nên NodeSDK là ít dependency/biến số hơn.
- `@langfuse/otel` là Node.js ≥20; không dùng processor trong Edge runtime. ([SDK package matrix](https://langfuse.com/docs/observability/sdk/overview#install-the-sdk))

### Flush/shutdown

Langfuse buffer spans bất đồng bộ. Short-lived scripts/serverless/workers phải flush hoặc shutdown để tránh mất dữ liệu; `shutdown()` gồm flush và dừng background workers. ([client lifecycle](https://langfuse.com/docs/observability/sdk/instrumentation#client-lifecycle--flushing))

Cho PartnerIQ:

- Không gọi `sdk.shutdown()` theo mỗi request; SDK là process-level singleton, shutdown theo request sẽ làm request sau mất tracing.
- Long-running Node server: để batching bình thường; shutdown ở process termination signal.
- Vercel/short-lived Next.js: export processor và dùng `after(() => langfuseSpanProcessor.forceFlush())`; đây là pattern chính thức cho Vercel Cloud Functions. ([Vercel flush pattern](https://langfuse.com/docs/observability/sdk/instrumentation#client-lifecycle--flushing))
- Với SSE IIFE, đăng ký `after(...)` trước khi `POST` trả `Response`; bảo đảm root observation end trước `writer.close()`. Response stream chỉ hoàn tất sau khi writer đóng, nên callback `after` chạy sau đó và flush được tail spans; flush trước root end sẽ không chứa các span cuối.
- Không flush từng source hoặc từng generation; flush blocks đến khi queue được xử lý và sẽ tăng latency/network overhead. ([flush behavior](https://langfuse.com/docs/observability/sdk/instrumentation#client-lifecycle--flushing))
- Generic serverless có `exportMode: "immediate"` tùy chọn, nhưng vẫn nên `forceFlush()` trước freeze/exit. ([generic serverless pattern](https://langfuse.com/docs/observability/sdk/instrumentation#client-lifecycle--flushing))

## 15. LangChain/LangGraph integration

PartnerIQ hiện không dùng LangChain/LangGraph. Không thêm framework chỉ để trace; direct SDK + OpenAI wrapper đã bao phủ workflow hiện tại.

Nếu sau này thực sự chuyển sang LangGraph:

1. Cài `@langfuse/langchain` cùng OTel setup hiện có.
2. Tạo `CallbackHandler` và truyền qua `{ callbacks: [handler] }` cho `invoke`; LangGraph dùng cùng pattern như LangChain.
3. Handler tự capture chains, LLMs, tools, retrievers, inputs, outputs và performance metrics. ([LangChain/LangGraph integration](https://langfuse.com/integrations/frameworks/langchain))
4. Bọc graph invoke trong PartnerIQ root `startActiveObservation` + `propagateAttributes`; callback spans tự nest dưới active observation. ([SDK interoperability example](https://langfuse.com/integrations/frameworks/langchain#interoperability-with-langfuse-sdks))
5. Truyền `runName`, tags và metadata `langfuseUserId`/`langfuseSessionId` nếu không dùng outer propagation. ([dynamic trace attributes](https://langfuse.com/integrations/frameworks/langchain#trace-attributes))
6. Với serverless và LangChain >0.3, callbacks chạy background; đặt `LANGCHAIN_CALLBACKS_BACKGROUND=false` hoặc gọi `awaitAllCallbacks` để không mất spans khi runtime freeze. ([serverless callbacks](https://langfuse.com/integrations/frameworks/langchain#serverless-environments-jsts))

Không tái sử dụng state như `last_trace_id` để map concurrent runs; tài liệu Langfuse cảnh báo cách này cần cẩn trọng trong concurrent environment. ([distributed LangChain trace IDs](https://langfuse.com/integrations/frameworks/langchain#trace-ids--distributed-tracing)) Lấy trace ID từ active context/root span của từng invocation.

## 16. Cloud hay self-host

### Langfuse Cloud — khuyến nghị cho demo/MVP

Ưu điểm: không vận hành PostgreSQL/ClickHouse/Redis/blob store, luôn thỏa SDK compatibility minimum, có nhiều data region. ([SDK overview](https://langfuse.com/docs/observability/sdk/overview), [Cloud regions](https://langfuse.com/security/data-regions)) Đây là lựa chọn phù hợp solo developer/hackathon.

Rủi ro:

- Pricing/retention/rate limits thay đổi theo plan; kiểm tra trang pricing ngay trước quyết định production. ([Cloud pricing](https://langfuse.com/pricing))
- Region tách biệt; chuyển region cần migration.
- Cloud cross-region disaster recovery hiện replicate Postgres subset, nhưng ClickHouse historical traces và S3 media không có out-of-region copy; Langfuse khuyến nghị blob export vào bucket riêng nếu trace history cần chống regional loss. ([availability and backup](https://langfuse.com/security/data-regions#cross-region-backup))
- Dữ liệu trace rời hạ tầng PartnerIQ; client-side minimization/masking là bắt buộc trước ingestion.

### Self-host — chỉ khi có yêu cầu data control/compliance rõ ràng

Open-source self-host có core observability, evaluation, prompt management và datasets; enterprise thêm các capability như project-level RBAC, retention policies, audit logs và server-side masking. ([self-hosted pricing/features](https://langfuse.com/pricing-self-host))

Gánh nặng vận hành không nhỏ: Langfuse v4 dùng web + worker containers, PostgreSQL, ClickHouse, Redis và S3/blob storage; minimum guidance liệt kê riêng CPU/RAM cho từng service. ([v3 → v4 infrastructure](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4), [scaling requirements](https://langfuse.com/self-hosting/configuration/scaling)) Docker Compose phù hợp thử/local nhưng thiếu HA, scaling và backup; tài liệu khuyến nghị Kubernetes cho high availability/high throughput. ([Docker Compose deployment](https://langfuse.com/self-hosting/deployment/docker-compose))

Kết luận: self-host không đáng cho PartnerIQ demo. Chỉ mở khi sponsor yêu cầu telemetry không rời VPC/quốc gia, có đội vận hành và chấp nhận backup/upgrade/monitoring của toàn stack.

## 17. Rollout đề xuất

### Phase 1 — observability baseline

- Pin SDK v5 package versions.
- NodeSDK + one span processor + client-side mask.
- Root/phase/source spans.
- `observeOpenAI` tại adapter duy nhất.
- 100% sampling.
- Environment/release/user/session/run metadata.
- Error level/status cho swallowed source failures.
- One flush at workflow completion trên serverless.

### Phase 2 — evaluation

- Deterministic scores từ existing schema/confidence/outcome.
- User feedback boolean.
- Dataset từ verified Vietnamese companies.
- LLM judge sampled chỉ cho semantic quality.

### Phase 3 — prompt management

- Migrate hai hard-coded prompts profile/analyst.
- Production label + local fallback.
- Link exact prompt object vào generations.
- Experiment trước promote/rollback.

### Chỉ khi phát sinh nhu cầu

- LangChain/LangGraph callback khi framework được adoption vì lý do orchestration khác.
- W3C carrier khi thật sự tách worker/process.
- Sampling <100% khi ingestion cost/noise đã đo được.
- Self-host khi có compliance/data-control requirement cụ thể.

## 18. Acceptance checks khi triển khai

1. Một research SSE job tạo đúng một trace; root duration gần tổng pipeline duration.
2. Source spans là sibling đúng thứ tự hiện tại; khi đổi parallel vẫn chung parent.
3. Profile/analyst OpenAI calls xuất hiện đúng một lần dưới module span.
4. Generation có model, input/output đã mask, token usage, cost và error/latency.
5. Partial source failure tạo source `ERROR`, root `WARNING`, workflow vẫn hoàn tất.
6. Zero findings tạo root `ERROR`.
7. `userId`, `sessionId`, `version`, tags và metadata có trên mọi observation mong đợi.
8. Không có API key, cookie, authorization header, email/phone/raw page trong exported payload.
9. Vercel/serverless test vẫn thấy tail span cuối cùng sau function completion.
10. Hai concurrent jobs không lẫn trace/session/metadata.
11. Nếu dùng prompt management, generation link đúng exact prompt version và fallback không làm request fail.
12. Nếu sampling được bật, xác nhận score/trace loss là chủ ý và dashboard denominator được hiểu đúng.

## 19. Risk register

| Mức | Rủi ro | Giảm thiểu |
|---|---|---|
| Cao | Root span end khi `POST` trả SSE, trước background IIFE | Mở root trong IIFE, await toàn pipeline |
| Cao | Runtime freeze trước batch export | `forceFlush` sau root; Vercel dùng `after` |
| Cao | Raw scraped text chứa PII/secret/prompt injection được gửi telemetry | Minimize payload + client-side mask + tests |
| Cao | Dùng `@langfuse/otel` trong Edge | Giữ Node runtime ≥20 |
| Trung bình | Manual generation + `observeOpenAI` gây duplicate usage/cost | Chọn wrapper cho LLM; manual chỉ cho business spans |
| Trung bình | Swallowed source errors không được auto capture | Set `level: ERROR`/`statusMessage` thủ công |
| Trung bình | Parallel worker làm mất parent context | Await branches; W3C inject/extract qua process boundary |
| Trung bình | Baggage làm lộ PII ra outbound headers | Chỉ propagate non-sensitive opaque IDs |
| Trung bình | Custom filtering làm đứt trace tree | Giữ v5 default; compose và test nếu override |
| Trung bình | Ratio sampling bỏ failure và associated scores | 100% ở MVP; chỉ giảm sau khi đo |
| Trung bình | Prompt cold fetch làm fail workflow | Production label + local fallback + cache |
| Trung bình | Prompt cache phục vụ version cũ trong TTL | Link exact version; TTL phù hợp rollout |
| Trung bình | LangChain callbacks background mất spans serverless | Blocking callback hoặc `awaitAllCallbacks` |
| Trung bình | Cloud mất historical trace/media khi mất region | Blob export riêng nếu history là critical |
| Trung bình | Self-host tốn vận hành hơn giá trị demo | Dùng Cloud cho MVP |
| Thấp | Model mismatch làm thiếu inferred cost | Chuẩn hóa model name/custom pricing/ingest usage |
| Thấp | SDK active development gây breaking behavior | Pin versions, test trace shape khi upgrade |

## 20. Quyết định đề xuất

Chọn **Langfuse Cloud + JS/TS SDK v5 direct instrumentation + OpenAI wrapper**, không thêm LangChain/LangGraph, không self-host và không sample cho MVP. Cấu hình này bám đúng code hiện tại, dùng ít package nhất, vẫn quan sát đủ workflow/source/generation, và giữ đường nâng cấp chuẩn OTel khi PartnerIQ có parallel workers hoặc graph orchestration thật sự.
