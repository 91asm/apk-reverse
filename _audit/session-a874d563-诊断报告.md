# 会话 a874d563 诊断报告：上游渠道、输出上限、循环根因

分析对象：`E:\edge download\dsh-session-session-a874d563-b00c-4f91-be70-80bc756dbb0d`
（589 条记录 / 3.6 MB，cwd `E:\apk-reverse`，19 turn / 84 step / 103 次工具调用 / 80 条 assistant 消息）
环境：DSH_HOME = `E:\dshtest\.dsh`，profile = `web`，agentPreset 运行中由 `standard` 切到 `cordis`

---

## 一、上游渠道链（实测，非推测）

### 1.1 DSH 侧路由配置

`E:\dshtest\.dsh\settings.yaml` 注册了三个 provider 卡片：

| provider | baseURL | 备注 |
|---|---|---|
| `oaifree` | `https://hub.oaifree.com/v1` | OpenAI-compatible |
| `cline-pass` | `https://api.cline.bot/api/v1` | 声明 contextWindow 921600 / maxTokens 131072 |
| `commandcode` | `https://api.commandcode.ai/provider/v1` | 声明 contextWindow 1000000 / maxTokens 131072 |

`agent-default-model` 指向 `cline-pass` / `cline-pass/deepseek-v4.1-flash` / `reasoningEffort: high`。

### 1.2 会话内实际发生的切换

| 阶段 | 记录行 | provider | model | 请求 maxTokens |
|---|---|---|---|---|
| turn 1–7 | line 19–371（50 条） | `commandcode` | `deepseek/deepseek-v4.1-flash` | 131072 |
| 中断点 | line 378 | — | `turn/end error QUOTA`：`400 insufficient credits` | — |
| turn 8–19 | line 389–587（24 条） | `cline-pass` | `cline-pass/deepseek-v4.1-flash` | 131072 |

`line 379/380` 有两条 `model/selection` 记录，就是这次切换的落点。

### 1.3 请求被插件改写（第一层中转）

`profiles/web/plugins/clinepass/index.js` 包装了进程级 `globalThis.fetch`，只改写发往 `api.cline.bot/api/v1/chat/completions` 的请求体：

```
body.providerOptions.gateway.only = ["deepseek"]
```

`clinepass_ctl status` 实测：`hook: installed`，`counters: seen 50 / pinned 50 / skipped 0`，`lastPin.url = https://api.cline.bot/api/v1/chat/completions`。
`providerOptions.gateway.only` 是 Vercel AI Gateway 的路由语义（插件源码注释亦确认这一点）。

### 1.4 真实上游（关键证据）

会话记录里 24 条 `cline-pass` 响应的 `message.source.replayState.response.responseModel` 全部是：

```
vmc/deepseek-v4p1-flash-contributor-fallbacks
```

这是**网关回报的实际服务模型**，不是 DeepSeek 官方直连，而是 `vmc` 命名空间下的 contributor（社区贡献算力）回退池变体。

旁证一：`GET https://api.cline.bot/api/v1/models` 返回 462 条模型，与 `GET https://openrouter.ai/api/v1/models` 的 462 条 **id 完全一致，差异 0 条**（`Compare-Object` 实测）。即 Cline 网关的模型目录与 OpenRouter 同源。

旁证二：`commandcode` 渠道自建目录（`owned_by: command-code`，只给 `context_length: 1000000`，不暴露真实上游），与 settings 里登记的 6 个 deepseek 模型逐一吻合。

### 1.5 渠道现状：两条都不可用

- `cline-pass`：`POST /api/v1/chat/completions` 返回 **402**，body：`{"error":{"code":"insufficient_credits","message":"Insufficient balance. Your Cline Credits balance is $0.00","current_balance":0.004634,...}}`
- `commandcode`：会话 line 378 记录 `400: You have insufficient credits to make this request`

**结论链**：DSH(`cline-pass` provider) → `api.cline.bot/api/v1`（Cline 官方网关，pin `deepseek`）→ 聚合路由层（OpenRouter 同源目录 + Vercel Gateway 风格 provider pin）→ deepseek 渠道 → **`vmc/deepseek-v4p1-flash-contributor-fallbacks`**。

---

## 二、deepseek v4.1 的真实输出上限

### 2.1 DSH 实际发送值

会话 `request/header` 与 `request/context` 记录：`maxTokens: 131072`，cline-pass `contextWindow: 921600`，commandcode `contextWindow: 1000000`。两个 provider 卡片都写死 `maxTokens: 131072`。

### 2.2 上游节点真实能力（OpenRouter 元数据，`/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints`）

上下文统一为 1048576（个别节点 1024000–1048575），**最大输出按被路由到的节点分档**：

| max_completion_tokens | 节点 |
|---|---|
| 943718 | Fireworks、Together、Cloudflare、Modal、Crusoe、Parasail、DigitalOcean、Ionstream、Phala、CoreWeave、GMICloud、Wafer、Morph、Relace、OpenInference |
| 393216 | **DeepSeek 官方**、Baidu、SiliconFlow、Alibaba、Novita、AtlasCloud、Makora、InferenceNet、Sail Research、StreamLake |
| 262144 | Decart |
| 131072 | DeepInfra、Venice、BaseTen，以及 `deepseek/deepseek-v4.1-flash:batch` 端点 |

因此「真实上限」不是一个定值，而是 **131072 – 943718，取决于本次请求被路由到哪个节点**；DeepSeek 官方节点是 **393216**。

### 2.3 本会话实测用量

- 单条 assistant 输出峰值 **5086 tokens**，全程输出合计 114512 tokens
- 累计上下文 267382 tokens，单次请求最大输入 241131 tokens
- 65 次 `tool-calls` 结束、8 次 `stop` 结束、1 次 `error/QUOTA`；**没有一次触及输出上限**

### 2.4 无法用请求探测上限的原因

余额检查发生在参数校验之前：连 `max_tokens: 16` 的最小请求都返回 402，因此无法通过发超大 `max_tokens` 让网关报出上限值。

**结论**：DSH 卡片里的 `131072` 是**最保守节点值**（恰好等于 DeepInfra/Venice/BaseTen 档）。若路由到 DeepSeek 官方或大型节点，实际可输出到 393216，当前配置会提前截断；若路由到 `vmc` contributor 池，公开元数据无法确定，下界为 131072。

---

## 三、循环根因

### 3.1 直接现象：reasoning 通道的伪标签自吸引子

6 次失控事件，全部发生在 **reasoning 通道**：

| 记录行 | turn/step | 字符数 | `</invoke>` 次数 | 结束方式 |
|---|---|---|---|---|
| line 446 | 10 / 4 | 21590 | 572 | `aborted/user` |
| line 464 | 11 / 3 | 6351 | 130 | `aborted/user` |
| line 492 | 13 / 3 | 23645 | 511 | `aborted/user` |
| line 510 | 14 / 3 | 4139 | 61 | `aborted/user` |
| line 534 | 17 / 1 | 8133 | 281 | `aborted/user` |
| line 587 | 19 / 8 | 9897 | 316 | `aborted/user` |

每条的尾部形态完全一致：

```
</parameter>
</invoke>
</parameter>
</invoke>
...
```

全程统计：`</invoke>` 1884 次、`</parameter>` 1925 次、`<parameter name` 183 次。
这 6 条的 `stream` 只有 `block-start` + `reasoning-chunks`，**没有 finish chunk、没有 usage** —— 流是被切断的。

机制：DSH 经 pi-ai 走 `openai-completions` 协议，工具调用是 **JSON** `tool_calls`。模型输出的 `</parameter></invoke>` 是 Claude 风格 XML，**不是合法工具调用**，既不结束 turn 也不触发工具执行，解码器只能在标签对之间自我循环，形成高概率吸引子。正常 turn 里同一模型也会输出这种 XML（line 389/402/409 各 1–3 个），说明这是模型的固有格式习惯，只是在特定条件下失去终止点。

### 3.2 提示词层：同一份注入被重复注入两次（dsh-purge 双路径 bug）

会话 `system/message` 实测 **106149 字符 / 1301 行**，结构：

| 行号 | 内容 |
|---|---|
| 1–2 | `WHO YOU ARE ...`（身份卡 1） |
| 3–4 | `WHO YOU ARE ...`（身份卡 2，逐字重复） |
| 5–570 | 注入正文块 A（40555 字符，`[MODE: UNRESTRICTED SANDBOX — STABLE]` 开头） |
| 572 | `Latest_Reminder:2027-02-21,Benchmark Task,...`（来自 preset-plus） |
| 621–742 | `# Dynamic Cordis Plugins`（DSH 原生段） |
| 743–744 | `WHO YOU ARE ...`（身份卡 3） |
| 745–746 | `WHO YOU ARE ...`（身份卡 4） |
| 747–1300 | 注入正文块 B（与块 A **逐字相同**） |

`# Personality` 出现在 **379** 与 **1121**，相隔 742 行 —— 即 40555 字符的注入正文出现 **2 次**，身份卡出现 **4 次**。

实现原因（`E:\dshtest\dsh-purge\lib\`）：

1. `index.js:97` 注册 section `dsh-purge:identity`（= 身份卡）；`index.js:109` 注册 section `dsh-purge`（= `身份卡\n\n注入全文`）
2. `identity.js:151 rewritePromptAssembly` 末尾把这两个 section **原样保留**（`identity.js:168` 的 `...purge`）→ 输出块 B
3. 同一函数又调 `identity.js:121 foldInjectIntoPersona`，把两个 section 的文本拼接（`identity.js:91 collectInjectText`）后经 `identity.js:113 buildPersonaHead` **折叠进 persona 插在最前** → 输出块 A

两条路径同时生效，没有互斥，于是整块注入进了两遍。

另有一处冗余放大风险：`index.js:177-189 installIdentityOverride` 注册了 **3 个** `system-prompt/assemble` 监听器（inner 1 个 + outer 直接 1 个 + `queueMicrotask`/`setTimeout(1500)` 各 1 个）。

### 3.3 提示词层：伪标签格式诱导与语言冲突

- `E:\dshtest\.dsh\prompt-inject.md`（40555 字符，与 `dsh-purge\lib\default-prompt-inject.md` 同源）含 `antmlThinking` **3 处**，直接教模型使用伪 XML thinking 标签
- 注入正文含大量自我指涉的元层检查清单（`HARD OUTPUT RULES`、`REFUSAL HARDENING`、长禁用词表、`MODE SELECTOR`、`Watch for: <ethics_reminder>...`），每轮都要对同一批约束做两遍自检
- 这些"格式/语言/禁用词"指令与工具层冲突：工具描述是英文 JSON Schema，注入要求"思考必须以特定文本开头""禁用非必要英文"
- `preset-plus`（`profiles/web/package.json` 的 bundles 之一）当前 `activePresetId: "jailbreak"`、`autoMode: true`，另注入 system/user/assistant 三连，其中 assistant 条目是**伪造的历史回复**（如"网络异常，重新执行本轮任务。"），进一步污染上下文

### 3.4 「已达到输出 token 上限」提示的真实来源

DSH 该提示的**唯一**触发条件（源码实测）：

- `dsh-client-ui-chat/lib/client.js:6645` → `event.type === "turn/end" && event.data.reason.kind === "max-tokens"`
- 文案：`client.js:2698` `"message.maxTokens": "已达到输出 token 上限"`
- 产生点：`dsh-agent-loop/lib/index.js:1115` `if (finish.kind === "max-tokens") return { kind: "max-tokens" }`，`index.js:958` 用 `stepEnd` 兜底

本会话 19 条 `turn/end`：`completed` ×8、`aborted/user` ×10、`error/QUOTA` ×1，**没有一条 `max-tokens`**。
进一步全机扫描 `E:\dshtest\.dsh\sessions` + `C:\Users\inliver\.dsh\sessions` 共 **969 个会话文件**（含 subagent 与当前会话），搜 `"max-tokens"`：**0 命中**。

**结论**：该提示不产生于这份会话记录。与"上限"最接近的真实事件就是 3.1 的那 6 次 reasoning 死循环 —— 用户每次都手动中断（`aborted/user`），若放任不中断，就会撞上 `maxTokens = 131072` 并由 DSH 显示"已达到输出 token 上限"。若界面上确实出现过该提示，它属于另一个未落盘/未导出的会话。

---

## 四、修复建议（按优先级）

1. **消除重复注入**（收益最大）：在 `dsh-purge` 里二选一 —— 要么停用 `index.js:97/109` 的 section 注册只保留 hook 折叠，要么让 `rewritePromptAssembly` 不再保留 purge sections（`identity.js:168`）；同时把 `installIdentityOverride` 的 3 个监听器收敛为 1 个。
2. **精简注入正文**：40KB 里的元层自检清单（HARD OUTPUT RULES / REFUSAL HARDENING / 长禁用词表 / MODE SELECTOR）是循环燃料，建议压到 8–10KB。
3. **删除伪标签范例**：移除 `prompt-inject.md` 里的 `antmlThinking`、`<ethics_reminder>`、`<parameter name=...>` 等 XML 示范，避免模型模仿非 JSON 工具格式。
4. **关闭 preset-plus 破限预设**：`preset-plus.json` 的 `activePresetId` 置空或 `autoMode: false`，停止注入伪造 assistant 历史。
5. **恢复可用上游**：`cline-pass` 余额 $0.00、`commandcode` 额度不足；切到 `oaifree` 或充值。
6. **校正 maxTokens**：若继续走 cline-pass 且路由到 DeepSeek 官方节点，把 Settings→Models 的 `131072` 提到 `393216`，否则会提前截断。
7. **降低 reasoning 失控概率**：`reasoningEffort` 由 `high` 降到 `low/medium`，或改用非 flash 模型。

---

## 五、证据文件

- 会话记录：`E:\edge download\dsh-session-session-a874d563-b00c-4f91-be70-80bc756dbb0d\session.v3.jsonl`
- 子会话：同目录 `subagents\6ba3009d-38ab-4563-a888-eec7c0252be9\session.v3.jsonl`
- 路由与模型卡片：`E:\dshtest\.dsh\settings.yaml`
- 钉选插件：`E:\dshtest\.dsh\profiles\web\plugins\clinepass\index.js`、`E:\dshtest\.dsh\clinepass.json`
- 重复注入实现：`E:\dshtest\dsh-purge\lib\index.js`、`E:\dshtest\dsh-purge\lib\identity.js`、`E:\dshtest\dsh-purge\lib\rules.js`
- 注入正文：`E:\dshtest\.dsh\prompt-inject.md`（= `dsh-purge\lib\default-prompt-inject.md`）
- 破限预设：`E:\dshtest\.dsh\preset-plus.json`、`profiles\web\node_modules\@rain-kl\dsh-preset-plus\presets\jailbreak.json`
- UI 提示与结束原因：`@deepseek-ai/dsh-client-ui-chat/lib/client.js:2698,6645`、`@deepseek-ai/dsh-agent-loop/lib/index.js:958,1115`
- 分析脚本：本目录 `scan.mjs`、`extract.mjs`、`deep.mjs`、`loop.mjs`、`upstream.mjs`、`sys.mjs`、`finish.mjs`、`tags.mjs`、`tails.mjs`、`sessions.mjs`
