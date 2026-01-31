# ComfyUI 本地/局域网集成设计

## 1. 目标

在画布侧栏**除 Media 和 Logic 之外**新增 **ComfyUI** 工具栏分组，支持调用本地或局域网上的 ComfyUI 服务，类似 RunningHub 的用法，但可自定义 ComfyUI 地址与工作流。

## 2. 工具栏与节点

### 2.1 侧栏结构

- **Media**：Image / Text / Video  
- **Logic**：LLM / Idea Gen / Relay / Magic / RunningHub / 画板  
- **ComfyUI**（新增）：
  - **ComfyUI**：一个可拖拽/点击添加的节点，用于配置 ComfyUI 地址、粘贴 workflow JSON、填写暴露的输入参数并执行。

### 2.2 节点类型

- `comfyui`：主节点，配置 baseUrl、workflow（API 格式 JSON）、可选输入槽并执行。
- `comfy-config`（预留）：类似 rh-config，可用于「从主节点展开的配置面板」或「工作流模板选择 + 参数表单」。

## 3. 配置项设计

### 3.1 全局配置（可选）

- **ComfyUI 默认地址**：`baseUrl`，如 `http://127.0.0.1:8188` 或 `http://192.168.1.100:8188`。
- 存储位置：前端 `localStorage`（`comfyui_config`）或后端 `settings.json`（`comfyuiBaseUrl`）。
- 节点内可覆盖：每个 `comfyui` 节点可填写自己的 `comfyBaseUrl`，为空则用全局配置。

### 3.2 节点级配置（comfyui 节点）

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `comfyBaseUrl` | string | 留空用全局；否则用节点内填写的地址（本地/局域网） |
| `workflowApiJson` | string | ComfyUI 中「API」导出的 workflow JSON，可直接粘贴 |
| `workflowTemplateId` | string | 可选，若支持「工作流模板库」则选模板 ID |
| `comfyInputSlots` | array | 暴露的输入槽：`slotKey`、`label`、`type`、`nodeId`、`inputName` |
| `comfyInputs` | Record<string, string> | 用户填写的输入值，key 为 slotKey |
| `outputImages` | string[] | 执行完成后输出图片 URL（经后端 /view 代理） |
| `outputPromptId` | string | ComfyUI 返回的 prompt_id |
| `error` | string | 错误信息 |

### 3.3 输入槽（暴露节点的逻辑）

**目标**：把 ComfyUI workflow 里「需要用户填写的输入」暴露成画布上的表单字段，类似 RunningHub 的 `nodeInfoList`。

**输入槽结构**（`comfyInputSlots` 每项）：

- `slotKey`：唯一键，如 `positive_prompt`、`seed`。
- `label`：展示名称，如「正向提示词」。
- `type`：`STRING` | `IMAGE` | `INT` | `FLOAT` | `BOOLEAN`。
- `nodeId`：ComfyUI workflow 中对应节点的 id（如 `"3"`）。
- `inputName`：该节点上的输入名（如 `text`、`seed`）。
- `description`：可选说明。

**来源方式（二选一或并存）**：

1. **手动定义**：用户保存/选择「工作流模板」时，在模板里附带 `inputSlots` 列表（在应用内或外部 JSON 中维护）。
2. **自动解析**：根据 ComfyUI `/object_info` 与 workflow JSON，识别常见「输入型」节点（如 `CLIPTextEncode` 的 `text`、`KSampler` 的 `seed`、`LoadImage` 的 `image`），自动生成 `comfyInputSlots`；用户可在节点上微调 label/顺序。

**执行时代入**：

- 执行前，根据 `comfyInputSlots` + `comfyInputs`，把用户填写的值写回 workflow JSON 中对应 `nodeId.inputName`，再 POST 到 ComfyUI `/prompt`。

## 4. 后端代理（避免 CORS）

ComfyUI 在本地或局域网，浏览器直连可能遇到 CORS 或跨域；由后端代理到用户配置的 `baseUrl`。

| 后端路由 | 方法 | 作用 |
|----------|------|------|
| `/api/comfyui/proxy` | POST | body: `baseUrl?`, `path`, `method?`, `body?`，转发到 `baseUrl + path` |
| `/api/comfyui/upload-image` | POST | body: `baseUrl?`, `image`(base64)，转发到 ComfyUI `/upload/image` |
| `/api/comfyui/view` | GET | query: `baseUrl`, `filename`, `subfolder?`, `type?`，代理 ComfyUI `/view` 取图 |
| `/api/comfyui/config` | GET/POST | 读/写默认 `baseUrl`（存后端时可选用） |

- 若请求体/查询参数中带 `baseUrl`，优先用该值；否则用后端存储的默认 ComfyUI 地址。

## 5. 前端 API（services/api/comfyui.ts）

- `getComfyUIConfig()` / `saveComfyUIConfig(baseUrl)`：读/写前端默认地址。
- `comfyuiProxy({ baseUrl?, path, method?, body? })`：通用代理。
- `comfyuiSubmitPrompt(prompt, baseUrl?, clientId?)`：POST workflow 到 `/prompt`，返回 `promptId`。
- `comfyuiGetHistory(promptId, baseUrl?)`：GET `/history/{promptId}`，取执行结果与输出图片信息。
- `comfyuiUploadImage(imageBase64, baseUrl?)`：上传图片到 ComfyUI。
- `comfyuiGetObjectInfo(baseUrl?)`：GET `/object_info`，用于解析节点类型与可编辑输入。

## 6. 执行流程（comfyui 节点 RUN）

1. 解析 `workflowApiJson` 为 `prompt`；可选：用 `comfyInputSlots` + `comfyInputs` 写回 workflow 中对应节点输入。
2. 调用 `comfyuiSubmitPrompt(prompt, baseUrl)`，得到 `promptId`。
3. 轮询 `comfyuiGetHistory(promptId, baseUrl)`，直到该 `prompt_id` 有 `outputs`（或超时/失败）。
4. 从 `outputs` 中收集所有 `images` 的 `filename`、`subfolder`、`type`，拼出 `/api/comfyui/view?baseUrl=...&filename=...&subfolder=...&type=...` 作为图片 URL 列表。
5. 更新节点：`status: 'completed'`，`data.outputImages` = 上一步 URL 列表，`data.outputPromptId` = promptId；错误时写 `data.error` 并 `status: 'error'`。

## 7. 与 RunningHub 的对比

| 能力 | RunningHub | ComfyUI 集成 |
|------|------------|--------------|
| 地址 | 固定云端 | 可配置本地/局域网 baseUrl |
| 应用/工作流 | 通过 webappId 拉取 nodeInfoList | 粘贴 workflow API JSON，可选模板 + inputSlots |
| 参数暴露 | 服务端返回 nodeInfoList | 手动定义或从 workflow/object_info 解析 inputSlots |
| 执行 | runAIApp(webappId, nodeInfoList) | POST /prompt，轮询 /history，取图经 /view |

## 8. 后续可扩展

- **工作流模板库**：在设置或侧栏中管理多份「workflow API JSON + inputSlots」，节点下拉选择模板后自动带出输入表单。
- **comfy-config 节点**：从 comfyui 节点「加载配置」后生成，展示模板名、封面图与所有 inputSlots 的填写区，RUN 时与主节点共用同一套执行逻辑。
- **输入连线**：画布上 Image/Text 节点连到 comfyui（或 comfy-config）的「端口」时，将上游内容映射到对应 slotKey（如图片 → 某 LoadImage 的 image），执行前写入 workflow。
