# PebblingCanvas 模块结构说明

## 目录概览

```
PebblingCanvas/
├── index.tsx               主组件：状态管理、渲染JSX、画布核心逻辑
├── CanvasNode.tsx           节点渲染组件（按节点类型分别渲染）
├── types.ts                 内部类型定义（Props、Options、Metadata）
├── canvasUtils.ts           纯工具函数（图片处理、格式转换、数据转换）
├── canvasApi.ts             AI API 适配器（文生图/图生图/LLM 接口桥接）
├── PreviewThumbnail.tsx     预览缩略图（懒加载 + 单击选封面/双击原图预览）
├── ComfyUISlotInput.tsx     ComfyUI 工作流参数输入（IMAGE 上传/文本/数字/布尔）
├── CustomSelect.tsx         自定义下拉选择器（深色/浅色主题适配）
├── FloatingInput.tsx        浮动输入框
├── Sidebar.tsx              侧边栏面板
├── ContextMenu.tsx          右键菜单
├── Icons.tsx                图标组件集合
├── ImageGenPanel.tsx        图片生成面板
├── PresetCreationModal.tsx  预设创建弹窗
├── PresetInstantiationModal.tsx  预设实例化弹窗
├── CanvasNameBadge.tsx      画布名称标签
├── MultiAngle3D.tsx         3D 多角度预览（lazy 加载）
├── ApiSettings.tsx          API 设置面板
└── Intro.tsx                引导介绍页
```

---

## 各模块功能详述

### types.ts
画布组件内部共享的 TypeScript 类型：
- `ImageGenOptions` — AI 生成失败回调选项
- `ImageMetadata` — 图片宽高/大小/格式元数据
- `BatchSavedOptions` — 批量保存参数
- `PebblingCanvasProps` — 主组件 Props 接口

### canvasUtils.ts
无依赖的纯工具函数：
- `uuid()` — 短随机 ID 生成
- `isValidVideo()` / `isValidImage()` — 媒体内容有效性检查
- `base64ToFile()` — Base64/URL/本地路径 → File 对象转换
- `extractImageMetadata()` — 提取图片宽高、大小、格式
- `resizeImageClient()` — 客户端图片缩放（多种模式）
- `truncateAgentResultForPrompt()` — 截断智能体输出用于提示词
- `canvasNodeToWorkflowNode()` — 画布节点 → 工作流节点转换

### canvasApi.ts
桥接 `geminiService` 的 AI 接口适配器：
- `isApiConfigured()` — 检查 API Key 是否已配置
- `generateCreativeImage()` — 文生图
- `editCreativeImage()` — 图生图（多图输入）
- `generateCreativeText()` — 文本扩写
- `generateAdvancedLLM()` — 通用 LLM 文本处理

### PreviewThumbnail.tsx
预览节点中的缩略图组件，特性：
- `IntersectionObserver` 懒加载，进入视口才渲染
- 单击选择封面，双击打开原图全屏预览
- 支持图片和视频两种媒体类型
- 使用 `React.memo` 优化渲染

### ComfyUISlotInput.tsx
ComfyUI 工作流节点的参数输入组件：
- IMAGE 类型：本地上传 + 从创意库选择 + ComfyUI 服务器上传
- STRING 类型：多行文本输入
- INT / FLOAT 类型：数字输入（含 onBlur 校验）
- BOOLEAN 类型：CustomSelect 下拉选择

### CustomSelect.tsx
替代原生 `<select>` 的自定义下拉组件：
- 深色/浅色主题自适应
- 点击外部自动关闭
- hover 高亮 + 选中状态标记

### index.tsx（主组件）
画布核心，包含：
- 全部状态声明（nodes、connections、canvas 列表等）
- 节点执行逻辑（handleExecuteNode 等）
- 鼠标/键盘交互（拖拽、连线、选区、快捷键）
- 渲染 JSX（画布、节点、连线、UI 面板）
- 数据持久化（保存/加载/导入导出）

### CanvasNode.tsx
单个节点的渲染组件，按节点类型分别渲染：
- image / edit / video / text / llm / resize / relay
- comfyui / runninghub / remove-bg / upscale
- bp（蓝图智能体）/ kling-o1 / preview
- 包含 `React.memo` + 自定义比较函数优化
