# LangChain JS/TS cho kiểm soát workflow nghiên cứu doanh nghiệp

**Ngày khảo sát:** 2026-08-25  
**Phạm vi nguồn:** chỉ tài liệu, API reference và repository chính thức của LangChain/LangGraph.  
**Kết luận:** Không thay pipeline nghiên cứu xác định hiện tại bằng agent. Chỉ đưa LangChain vào bên trong `LLMAdapter` khi PartnerIQ thực sự cần đổi provider, fallback hoặc tracing chuẩn hóa; giữ source orchestration, timeout và event streaming ở module hiện tại. Không thêm loader/retriever hoặc LangGraph lúc này.

## 1. Baseline phiên bản

- Tag chính thức mới nhất quan sát được ngày 2026-08-25: [`langchain@1.5.10`](https://github.com/langchain-ai/langchainjs/releases/tag/langchain%401.5.10), [`@langchain/core@1.2.9`](https://github.com/langchain-ai/langchainjs/releases/tag/%40langchain%2Fcore%401.2.9), [`@langchain/openai@1.5.10`](https://github.com/langchain-ai/langchainjs/releases/tag/%40langchain%2Fopenai%401.5.10) và [`@langchain/langgraph@1.4.12`](https://github.com/langchain-ai/langgraphjs/releases/tag/%40langchain%2Flanggraph%401.4.12).
- LangChain 1.x và LangGraph 1.x là nhánh LTS đang ACTIVE; public API tuân theo semver trong major version. Patch được phát hành thường xuyên, còn `@langchain/community` không có cùng mức bảo đảm semver với `langchain`/`@langchain/core` ([release policy](https://docs.langchain.com/oss/javascript/release-policy)).
- Nếu triển khai, pin đúng phiên bản đã thử nghiệm và commit lockfile. Không sao chép ví dụ từ docs mà không đối chiếu API reference của phiên bản đã pin; ví dụ `stampRetryable` yêu cầu `@langchain/core>=1.2.8` và `langchain>=1.5.9` ([middleware docs](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#mark-an-error-as-retryable)).

## 2. Ngữ cảnh PartnerIQ hiện tại

- `src/adapters/llm/types.ts` đã có ranh giới tốt: `complete`, `completeStructured`, `stream`, cùng `LLMOptions` độc lập provider.
- `src/adapters/llm/openai.ts` dùng OpenAI SDK trực tiếp, Zod 4 và `zodResponseFormat`; structured output được parse lại bằng `schema.parse`. Đây đã là đường đi ngắn và đúng khi chỉ dùng OpenAI.
- `src/modules/profile/index.ts` và `src/modules/analyst/index.ts` sở hữu schema Zod của output. Không nên tạo schema LangChain thứ hai.
- `src/modules/research/index.ts` chạy các nguồn tuần tự, phát progress event và áp timeout. Đây là orchestration nghiệp vụ xác định; model không cần quyết định nguồn nào chạy.
- `src/config/index.ts` khai báo `maxTokensPerResearch`, `maxLLMCallsPerResearch` và `maxRetriesPerSource`, nhưng scan code hiện tại không thấy các guard này được tiêu thụ trên đường gọi LLM/source. `OpenAIAdapter` chỉ ghi usage sau khi gọi; `stream()` chưa ghi usage.
- `package.json` chưa có package LangChain/LangGraph; dự án đang dùng `openai@^7.5.0` và `zod@^4.4.3`.

## 3. Quyết định kiến trúc

| Nhu cầu | Quyết định cho PartnerIQ | Lý do |
|---|---|---|
| Structured profile/analysis với OpenAI | Giữ implementation hiện tại | Đã có provider-native structured output và Zod validation; LangChain không xóa được nhiều code hơn. |
| Đổi model/provider mà không đổi module nghiệp vụ | Dùng LangChain bên trong `LLMAdapter` | Các integration package triển khai cùng model interface; model/provider có thể đổi mà không viết lại caller ([models](https://docs.langchain.com/oss/javascript/langchain/models#supported-providers-and-models)). |
| Model tự chọn search/scrape tool | Chưa làm | Pipeline nguồn hiện tại là xác định, có rate-limit và progress semantics rõ; agent loop sẽ tăng call, cost và độ khó kiểm thử. |
| Durable resume/checkpoint/HITL hoặc nhánh động phức tạp | Cân nhắc LangGraph sau | LangGraph dành cho orchestration low-level, stateful, durable và workflow kết hợp bước deterministic/agentic ([product boundary](https://docs.langchain.com/oss/javascript/concepts/products#agent-runtimes-like-langgraph)). |
| Hỏi đáp trên kho tài liệu đã index | Chỉ khi có use case RAG thật | Retrieval cần fetch/preprocess, splitter, embedding và vector store; PartnerIQ hiện nghiên cứu web theo request, không truy vấn corpus bền vững ([official RAG tutorial](https://docs.langchain.com/oss/javascript/langgraph/agentic-rag)). |

### Khuyến nghị tối thiểu

1. **Hiện tại:** giữ OpenAI SDK trực tiếp. Bổ sung LangChain chỉ khi một yêu cầu đã được chốt: provider thứ hai, model fallback xuyên provider hoặc LangSmith tracing.
2. **Khi yêu cầu đó xuất hiện:** thay ruột `OpenAIAdapter`, không thay interface và không thay `profile`/`analyst`. Với OpenAI-only, dùng model class trực tiếp để giữ toàn quyền cấu hình provider; `initChatModel` phù hợp hơn khi cần chọn provider/model qua identifier chuẩn hóa ([initialization and standard interface](https://docs.langchain.com/oss/javascript/langchain/models)).
3. **Không đưa `createAgent` vào chỉ để lấy retry/middleware.** Model/runnable độc lập đã có `maxRetries`, `withRetry` và `withFallbacks`; API `ChatOpenAI` trả `usage_metadata` và cung cấp các wrapper này ([ChatOpenAI reference](https://reference.langchain.com/javascript/langchain-openai/ChatOpenAI)).

## 4. Tool definitions

Nếu sau này model thực sự cần chọn nguồn, wrap **adapter hiện hữu** thành tool; không chuyển logic search/scrape vào tool mới.

- `tool(fn, { name, description, schema })` tạo callable tool; Zod schema mô tả và kiểm tra input. Tên `snake_case` tăng tương thích provider ([tools](https://docs.langchain.com/oss/javascript/langchain/tools#create-tools)).
- Tên, description, field description là context hướng model chọn đúng tool, không phải metadata trang trí ([context engineering](https://docs.langchain.com/oss/javascript/langchain/context-engineering#tools)).
- `bindTools()` chỉ cho model quyền **yêu cầu** tool call. Nếu gọi model không qua agent thì application vẫn phải execute tool và trả kết quả; agent mới sở hữu tool loop ([model tool calling](https://docs.langchain.com/oss/javascript/langchain/models#tool-calling)).
- Tool có thể trả string hoặc object. Dùng object nhỏ, có cấu trúc cho finding; không trả nguyên HTML dài. `returnDirect` chỉ phù hợp khi tool output đã là kết quả cuối và cần bỏ model call kế tiếp, không phù hợp với source result còn phải tổng hợp ([return directly](https://docs.langchain.com/oss/javascript/langchain/tools#return-directly-from-a-tool)).
- Nếu LangGraph cần xử lý tool call trực tiếp, dùng `ToolNode`; nó là building block cho graph tùy chỉnh và xử lý parallel execution/error/state injection ([ToolNode](https://docs.langchain.com/oss/javascript/langchain/tools#toolnode)). Không vừa dùng `ToolNode` vừa tạo một tool executor khác.

**Rủi ro:** tool-calling làm model quyết định thứ tự/số lần gọi, nên có thể phá giới hạn rate, progress event và tính tái lập của pipeline. Chỉ bật với `toolCallLimitMiddleware` hoặc guard tương đương; middleware có run/thread limit và exit behavior rõ ràng ([tool-call limits](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#tool-call-limit)).

## 5. Model abstraction

- Model interface chuẩn hóa `invoke`, `stream`, `batch`, tool calling và structured output; integration package truyền model name xuống provider nên model mới không nhất thiết cần LangChain release mới ([model methods and providers](https://docs.langchain.com/oss/javascript/langchain/models#supported-providers-and-models)).
- Các tham số chung gồm `temperature`, `maxTokens`, `timeout`, `maxRetries`; tham số thực tế vẫn khác theo provider ([model parameters](https://docs.langchain.com/oss/javascript/langchain/models#parameters)). Vì vậy `LLMOptions` hiện tại nên tiếp tục là contract hẹp của PartnerIQ, không expose toàn bộ config LangChain.
- Chọn model động bằng middleware có thể tối ưu cost theo state/context, nhưng đây là policy nghiệp vụ mới và không nên thêm trước khi có metric/threshold được xác nhận ([dynamic model selection](https://docs.langchain.com/oss/javascript/langchain/models#dynamic-model-selection)).
- Model profile có thể báo context window, tool calling và structured-output support, nhưng profile đang là **beta** và có thể thiếu/sai; production path phải có capability test hoặc profile override đã pin ([model profiles](https://docs.langchain.com/oss/javascript/langchain/models#model-profiles)).

**Rủi ro portability:** “cùng interface” không đồng nghĩa output giống nhau. Provider có khác biệt về schema support, nullable/optional, tool choice, token metadata và prompt caching. Mỗi model fallback phải chạy cùng contract tests của `LLMProfileSchema`/`LLMAnalysisSchema` trước khi được bật.

## 6. Structured output và schema validation

### Model call không dùng agent — phù hợp PartnerIQ

- `model.withStructuredOutput(zodSchema)` trả output có type và chạy Zod parse validation; Zod là lựa chọn được docs khuyến nghị ([model structured output](https://docs.langchain.com/oss/javascript/langchain/models#structured-output)).
- Tái sử dụng trực tiếp schema Zod hiện có. Đừng thêm output parser khác sau Zod trừ khi cần lưu raw response để chẩn đoán.
- Provider-native schema nên là lựa chọn đầu tiên khi model hỗ trợ. Với fallback provider, test từng schema; không tự động chuyển validation failure thành dữ liệu rỗng.

### Nếu sau này dùng `createAgent`

- `responseFormat` nhận Zod/Standard Schema/JSON Schema và trả dữ liệu ở `structuredResponse`. Có thể ép `providerStrategy` hoặc `toolStrategy`; mặc định LangChain chọn theo capability ([agent structured output](https://docs.langchain.com/oss/javascript/langchain/structured-output#response-format)).
- Provider strategy đáng tin cậy nhất khi API model hỗ trợ native schema; tool strategy dùng artificial tool call và có retry/error handler riêng ([provider vs tool strategy](https://docs.langchain.com/oss/javascript/langchain/structured-output#provider-strategy)).
- Tool strategy mặc định bắt lỗi schema/multiple-output và yêu cầu model sửa lại; `handleError: false` cho phép fail fast ([structured-output error handling](https://docs.langchain.com/oss/javascript/langchain/structured-output#error-handling)). Với profile/analysis, nên đặt số lần retry hữu hạn và fail rõ thay vì loop sửa vô hạn.

**Rủi ro:** structured output bảo đảm **shape**, không bảo đảm dữ kiện đúng hoặc citation hỗ trợ claim. Validation nghiệp vụ vẫn phải kiểm tra URL/source, confidence range, năm/thời gian và quan hệ giữa field sau model call.

## 7. Retry, fallback và middleware

### Cho adapter hiện tại

- Chỉ có **một** tầng retry model. Model config đã retry network/rate-limit/5xx với exponential backoff và jitter; agent retry middleware sẽ thay quyền retry cho call nó wrap ([connection resilience](https://docs.langchain.com/oss/javascript/langchain/models#connection-resilience)). Không bật cả OpenAI SDK retry, LangChain model retry và app retry với cùng số lần.
- Retry chỉ lỗi transient: timeout, rate limit, 5xx. Không retry auth, unknown model, context overflow, payload invalid hoặc quota exhausted; LangChain integration nhận diện các nhóm này và có retryability marker từ phiên bản nêu trên ([retryable errors](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#mark-an-error-as-retryable)).
- Fallback chỉ dành cho outage/provider failure, không dùng để che schema validation hoặc lỗi prompt. Standalone runnable có `withFallbacks`; agent có `modelFallbackMiddleware` với danh sách model theo thứ tự ([model fallback](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#model-fallback)).

### Nếu có agent loop

- `modelRetryMiddleware` và `toolRetryMiddleware` hỗ trợ exponential backoff, jitter, error filter và behavior khi hết retry ([prebuilt middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in)).
- Scope tool retry vào đúng network tool; không retry mọi tool. Retry một operation ghi dữ liệu có thể nhân đôi side effect nếu thiếu idempotency.
- Dùng `modelCallLimitMiddleware` và `toolCallLimitMiddleware` làm hard stop cho mỗi run; thread limit cần checkpointer ([call limits](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#model-call-limit)).

**Cấu hình khuyến nghị:** lấy guard hiện có làm source of truth; adapter/middleware chỉ đọc cùng budget, không tạo bộ số thứ hai. Tách retry của source network khỏi retry của model vì hai failure domain khác nhau.

## 8. Prompt, token và cost

### Prompt

- `ChatPromptTemplate` format message theo role và biến đầu vào; dùng nó nếu chuyển adapter sang LangChain để tách system instruction khỏi findings, nhưng không cần prompt registry/framework mới ([ChatPromptTemplate API](https://reference.langchain.com/javascript/langchain-core/prompts/ChatPromptTemplate)).
- Findings từ web là dữ liệu không tin cậy. Đặt chúng trong delimiter rõ, nói model bỏ qua instruction nằm trong tài liệu và giữ system policy ngoài vùng dữ liệu; official RAG example dùng đúng pattern này ([RAG grading prompt](https://docs.langchain.com/oss/javascript/langgraph/agentic-rag#grade-documents)). Structured output không ngăn prompt injection; guardrail có thể chặn/validate tại before-agent, around-model và after-agent hooks ([guardrails](https://docs.langchain.com/oss/javascript/langchain/guardrails)).
- Giữ phần instruction ổn định ở đầu prompt, dữ liệu biến động ở sau để tận dụng provider prompt caching khi đủ ngưỡng; cache hit được phản ánh trong usage metadata ([prompt caching](https://docs.langchain.com/oss/javascript/langchain/models#prompt-caching)).

### Token budget

- `maxTokens` chỉ giới hạn output, không phải tổng token/cost của một research run ([model parameters](https://docs.langchain.com/oss/javascript/langchain/models#parameters)). Cần enforce `maxTokensPerResearch` **trước mỗi call** từ usage đã cộng dồn và ước lượng input kế tiếp, sau đó đối chiếu usage thực tế.
- `AIMessage.usage_metadata` chuẩn hóa input/output/total token khi provider trả về ([token usage](https://docs.langchain.com/oss/javascript/langchain/messages#token-usage)). Map dữ liệu này vào `LLMUsageLog`; đừng phụ thuộc riêng `response_metadata` provider.
- `modelCallLimitMiddleware` ngăn runaway agent, nhưng không thay token budget vì mỗi call có kích thước khác nhau ([model-call limit](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#model-call-limit)).
- Pipeline PartnerIQ là single-turn synthesis, nên chưa cần summarization middleware. Nó thêm một model call và mặc định token counter chỉ dựa trên số ký tự; chỉ dùng cho history dài thực sự ([summarization middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#summarization)).

### Cost và observability

- LangSmith có thể tự ghi token/cost cho các provider chính và hiển thị theo trace/project/dashboard; custom component có thể gửi cost riêng ([cost tracking](https://docs.langchain.com/langsmith/cost-tracking)). Đây là observability, **không phải hard spending guard**.
- `RunnableConfig` hỗ trợ `runName`, tags, metadata và callbacks để gắn `researchId`, company và stage vào trace ([invocation config](https://docs.langchain.com/oss/javascript/langchain/models#invocation-config)). Không đặt raw API key hoặc dữ liệu nhạy cảm vào metadata.
- LangSmith tracing ghi model interaction, tool call và execution step ([observability](https://docs.langchain.com/oss/javascript/langchain/observability)). **Suy luận rủi ro:** vì findings doanh nghiệp và prompt sẽ xuất hiện trong trace, chỉ bật sau khi chính sách lưu trữ/redaction được phê duyệt; local usage log hiện tại vẫn là phương án nhỏ hơn.

## 9. LangChain và LangGraph: không trùng orchestration

- `createAgent` của LangChain đã chạy trên LangGraph; `createReactAgent` từ LangGraph prebuilt đã deprecated ([LangGraph v1](https://docs.langchain.com/oss/javascript/releases/langgraph-v1)). Không bọc `createAgent` bằng một graph chỉ để tái tạo cùng model→tool loop.
- LangChain sở hữu **component/policy**: model interface, tool schema, structured output, prompt và agent middleware. LangGraph sở hữu **workflow runtime**: state, nodes, edges, checkpoint, resume, streaming và HITL ([LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)).
- Nếu PartnerIQ cần durable workflow, graph node nên gọi module hiện hữu: `collect_sources` → `build_profile` → `analyze` → `persist`; edge quyết định retry/continue/fail. Chỉ một node con dùng `createAgent` khi bước đó thật sự cần model tự lặp tool.
- LangGraph v1 giữ core API ổn định nhưng đã bỏ Node 18 trong migration; xác nhận runtime Node LTS tương thích trước khi cài ([migration guide](https://docs.langchain.com/oss/javascript/migrate/langgraph-v1)).

## 10. Rủi ro và điều kiện kích hoạt

| Rủi ro | Kiểm soát tối thiểu |
|---|---|
| Dependency mới nhưng không giảm code | Không cài nếu vẫn OpenAI-only và không cần tracing/fallback. |
| Retry kép làm tăng latency/cost | Một retry owner; test số attempt và tổng timeout. |
| Fallback trả shape/semantics khác | Contract test mọi schema trên từng model/provider; pin model. |
| Agent gọi source quá nhiều/sai thứ tự | Giữ orchestration deterministic; nếu bật agent, hard call limits. |
| Prompt injection từ web | Delimiter + instruction “data only” + validation sau output; không cho tool ghi dữ liệu nhạy cảm. |
| Budget chỉ được ghi sau khi đã tiêu | Pre-call budget gate + post-call usage reconciliation. |
| Docs chạy trước package hoặc API beta | Pin versions; đối chiếu reference/tag; tránh model profile beta làm nguồn quyết định duy nhất. |
| Trace làm lộ nội dung nghiên cứu | Redact/disable tracing theo môi trường và chính sách dữ liệu. |

### Chỉ thêm từng phần khi

- **`@langchain/openai`/`@langchain/core`:** cần callbacks/usage chuẩn hóa hoặc runnable retry/fallback mà direct SDK không còn đủ.
- **`langchain`:** cần `initChatModel`, `createAgent` hoặc agent middleware.
- **Provider package thứ hai:** đã có model fallback được duyệt và contract test.
- **`@langchain/langgraph`:** cần checkpoint/resume, HITL, durable long-running run hoặc nhánh workflow động; không phải chỉ để vẽ pipeline hiện tại.
- **Loader/retriever/vector store:** có corpus bền vững, yêu cầu semantic retrieval và tiêu chí freshness/index lifecycle rõ.

## 11. Phương án áp dụng theo giai đoạn

1. **Không dependency mới:** enforce các guard token/call hiện có và sửa usage accounting ở adapter hiện tại trước. Đây là khoảng trống thực tế lớn hơn framework choice.
2. **Adapter-only pilot:** nếu cần provider portability, thay implementation sau `LLMAdapter`; reuse schema Zod; chạy unit/contract test trên `profile` và `analyst`; không đổi research orchestration.
3. **Agent pilot có điều kiện:** chỉ cho một bước discovery không xác định; tool call/model call limits, retry ownership và trace redaction phải có từ đầu.
4. **LangGraph sau cùng:** chỉ khi một run cần sống qua process failure/approval/resume. Khi đó chuyển orchestration sang graph một lần, không giữ thêm orchestrator song song.

