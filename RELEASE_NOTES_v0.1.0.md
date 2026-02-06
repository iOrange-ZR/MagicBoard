# Penguin Magic 魔改版 v0.1.0 更新说明

**版本**：v0.1.0  
**基于**：主项目画布与 API 能力  
**说明**：本仓库为独立魔改应用，拥有自己的版本号体系；v0.1.0 为首次发布版本，基于原 Penguin Magic 画布与 API 能力做了定制增强。

---

## 本次更新概要

### 多图/多视频对比预览节点

- **仅多结果时使用预览节点**：批量生成多张图或多个视频时，结果会合并为一个「预览节点」，在节点内以网格展示所有结果，并可点击某一张/个设为「引用封面」；后续节点引用该预览节点时，将使用当前选中的封面。
- **单图/单视频使用普通节点**：当只生成 1 张图或 1 个视频时，不再创建预览节点，直接创建普通 **image** 或 **video-output** 节点，行为与单次生成一致。
- **适用范围**：图生图/编辑批量、BP·Idea 批量、工具节点批量（去背/放大等）、视频批量、ComfyUI 多输出、RunningHub 主节点批量；上述场景均按「多结果 → 预览节点，单结果 → 单节点」规则处理。

### 预览节点持久化与恢复

- **保存时**：自动将预览节点内的多图/多视频（`previewItems`）以及当前选中的封面（`content`）从 base64/临时 URL 本地化到画布目录或输出目录，避免刷新后链接失效。
- **加载时**：根据 `previewCoverIndex` 自动恢复「当前选中的封面」对应的 `content`，保证刷新或重启后多图列表与选中状态一致。

### API 请求头字符编码修复

- **问题**：部分环境下出现 `Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point`，多与 API Key 中含不可见字符或非 Latin-1 字符有关。
- **处理**：新增 `utils/headers.ts` 中的 `sanitizeHeaderValue`，对所有写入 `Authorization` 等请求头的 API Key 进行清理（去除非 ISO-8859-1 字符），并在以下位置统一使用：
  - 画布/第三方：`pebblingGeminiService.ts`、`geminiService.ts`
  - 画布内 API 设置与余额查询：`ApiSettings.tsx`、`ApiKeyManager.tsx`
  - Sora / Veo：`soraService.ts`、`veoService.ts`

---

## 技术变更摘要

| 类型     | 说明 |
|----------|------|
| 新增类型 | `NodeType 'preview'`，`NodeData` 增加 `previewItems`、`previewCoverIndex`、`previewItemTypes`、`previewExpectedCount` |
| 新增工具 | `utils/headers.ts`：`sanitizeHeaderValue` |
| 画布逻辑 | 批量/多输出场景：单结果用 image/video-output，多结果用 preview；保存时本地化预览节点资源，加载时规范化预览节点 `content` |
| 请求头   | 所有使用 API Key 的 fetch 请求头均经 `sanitizeHeaderValue` 处理 |

---

## 使用说明

- **多图对比**：批量生成多张图或多段视频后，在预览节点中点击任意一张/段即可设为「引用」封面，下游节点将使用该封面。
- **单次生成**：生成数量为 1 时，会直接得到单个 image 或 video-output 节点，无需进入预览节点。
- **刷新与重启**：保存后，预览节点中的多图与选中状态会随画布一起持久化，刷新或重启应用后可正常显示并保持选中项。

---

*魔改版 v0.1.0 · 画布预览与 API 请求增强*
