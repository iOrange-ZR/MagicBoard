# T8 Star API 接入指南

> API (api.bltcy.ai) 接入完整文档

## 基础配置

```typescript
const API_BASE_URL = 'https://api.bltcy.ai';
const API_KEY = 'your-api-key';

// 通用请求头
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`
};
```

---

## 一、Chat API（文本/图片分析）

**端点**: `POST /v1/chat/completions`

### 兼容 OpenAI 格式，可直接用于：
- 纯文本对话
- 图片分析（Vision）
- 多轮对话

### 请求示例

```typescript
// 纯文本对话
const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'gemini-2.5-pro',  // 或其他支持的模型
    messages: [
      { role: 'system', content: '你是一个有帮助的助手' },
      { role: 'user', content: '你好' }
    ],
    max_tokens: 2000,
    temperature: 0.7,
    stream: false  // 是否流式返回
  })
});

const data = await response.json();
const reply = data.choices[0].message.content;
```

### 图片分析（Vision）

```typescript
// 图片分析 - content 需要是数组格式
const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'gemini-2.5-pro',
    messages: [
      { role: 'system', content: '你是图片分析专家' },
      { 
        role: 'user', 
        content: [
          { type: 'text', text: '描述这张图片' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,xxxxx' } }
        ]
      }
    ],
    max_tokens: 2000
  })
});
```

### 响应格式

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "这是AI的回复"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

---

## 二、Image Generation API（图片生成）

**端点**: `POST /v1/images/generations`

### 支持模式：
- 文生图（不传 image 参数）
- 图生图（传 image 参数）
- 多图参考（image 传数组）

### 请求示例

```typescript
interface ImageRequest {
  model: 'nano-banana-2';           // 模型名称
  prompt: string;                    // 提示词
  image?: string | string[];         // 图生图：base64 或 URL（可选）
  aspect_ratio?: '4:3' | '3:4' | '16:9' | '9:16' | '1:1' | '2:3' | '3:2';
  image_size?: '1K' | '2K' | '4K';   // 输出尺寸
  response_format?: 'url' | 'b64_json';
  seed?: number;                     // 随机种子
}

// 文生图
const response = await fetch(`${API_BASE_URL}/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'nano-banana-2',
    prompt: '一只可爱的猫咪',
    aspect_ratio: '1:1',
    image_size: '2K',
    response_format: 'url'
  })
});

// 图生图
const response = await fetch(`${API_BASE_URL}/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'nano-banana-2',
    prompt: '将图片风格转换为油画',
    image: 'data:image/png;base64,xxxxx',  // 或图片URL
    image_size: '2K',
    response_format: 'url'
  })
});
```

### 响应格式

```json
{
  "data": [
    {
      "url": "https://xxx.xxx/image.png",
      "b64_json": null
    }
  ]
}
```

---

## 三、Video Generation API（视频生成）

**端点**: 
- 创建任务: `POST /v2/videos/generations`
- 查询状态: `GET /v2/videos/generations/{task_id}`

### 支持模型

#### Sora 系列
- `sora-2` - 标准模式
- `sora-2-pro` - 高清模式（支持25秒）

#### Veo3.1 系列
- `veo3.1-fast` - 快速模式
- `veo3.1` - 标准模式
- `veo3.1-4k` - 4K 标准
- `veo3.1-pro` - 高质量
- `veo3.1-pro-4k` - 4K 高质量
- `veo3.1-components` - 多图参考
- `veo3.1-components-4k` - 4K 多图参考

### 1. 创建任务

```typescript
interface VideoRequest {
  prompt: string;                    // 提示词
  model: string;                     // 模型名称
  images?: string[];                 // 图生视频：base64 图片数组
  aspect_ratio?: '16:9' | '9:16';    // 宽高比
  duration?: '10' | '15' | '25';     // 时长（仅Sora）
  hd?: boolean;                      // 高清（仅Sora-pro）
  enhance_prompt?: boolean;          // 增强提示词（仅Veo）
  seed?: number;                     // 随机种子
}

const response = await fetch(`${API_BASE_URL}/v2/videos/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    prompt: '一只猫在草地上奔跑',
    model: 'veo3.1-fast',
    aspect_ratio: '16:9',
    enhance_prompt: true
  })
});

const { task_id } = await response.json();
// task_id 用于后续查询
```

### 2. 查询任务状态

```typescript
const response = await fetch(`${API_BASE_URL}/v2/videos/generations/${task_id}`, {
  method: 'GET',
  headers
});

const result = await response.json();
```

### 任务状态响应

```json
{
  "task_id": "xxx",
  "status": "SUCCESS",       // PENDING | RUNNING | SUCCESS | FAILURE
  "progress": "100%",
  "fail_reason": null,
  "data": {
    "output": "https://xxx.xxx/video.mp4"  // 视频URL
  }
}
```

### 3. 完整轮询示例

```typescript
async function createVideo(prompt: string, model: string): Promise<string> {
  // 1. 创建任务
  const createRes = await fetch(`${API_BASE_URL}/v2/videos/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, model })
  });
  const { task_id } = await createRes.json();
  
  // 2. 轮询等待完成
  const maxAttempts = 60;  // 最多等待10分钟
  const interval = 10000;   // 每10秒查询一次
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, interval));
    
    const statusRes = await fetch(`${API_BASE_URL}/v2/videos/generations/${task_id}`, {
      method: 'GET',
      headers
    });
    const result = await statusRes.json();
    
    if (result.status === 'SUCCESS') {
      return result.data.output;  // 返回视频URL
    }
    
    if (result.status === 'FAILURE') {
      throw new Error(result.fail_reason || '视频生成失败');
    }
    
    console.log(`进度: ${result.progress}`);
  }
  
  throw new Error('视频生成超时');
}
```

---

## 四、常见问题

### 1. 401 Unauthorized
- API Key 无效或过期
- 检查 Authorization 头格式：`Bearer ${API_KEY}`

### 2. 400 Bad Request
- 请求参数格式错误
- 检查 JSON 格式和必填字段

### 3. 图片格式要求
- 支持 URL 或 Base64
- Base64 需要带前缀：`data:image/png;base64,xxxxx`

### 4. 视频下载失败 (502)
- CDN 服务器临时问题
- 建议添加重试机制
- 视频URL有时效性，生成后尽快下载

### 5. 跨域问题 (CORS)
- 前端直接调用会遇到跨域
- 建议通过后端代理请求

---

## 五、TypeScript 类型定义

```typescript
// Chat API
interface ChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }>;
  }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface ChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
}

// Image API
interface ImageRequest {
  model: string;
  prompt: string;
  image?: string | string[];
  aspect_ratio?: string;
  image_size?: '1K' | '2K' | '4K';
  response_format?: 'url' | 'b64_json';
  seed?: number;
}

interface ImageResponse {
  data: Array<{
    url?: string;
    b64_json?: string;
  }>;
}

// Video API
interface VideoRequest {
  prompt: string;
  model: string;
  images?: string[];
  aspect_ratio?: '16:9' | '9:16';
  duration?: string;
  enhance_prompt?: boolean;
  seed?: number;
}

interface VideoTaskResponse {
  task_id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILURE';
  progress?: string;
  fail_reason?: string;
  data?: { output?: string };
}
```

---

## 六、与官方 Gemini SDK 的区别

| 特性 | 官方 Gemini SDK | T8 API |
|------|----------------|--------|
| 端点 | Google 官方 | api.bltcy.ai |
| 认证 | API Key 初始化 SDK | Bearer Token |
| Chat | SDK 方法调用 | OpenAI 兼容格式 |
| 图片生成 | SDK 内置 | 独立端点 |
| 视频生成 | 不支持 | 异步任务 |
| 网络要求 | 需要翻墙 | 国内直连 |

**如果你的项目已接入官方 Gemini SDK**，迁移到 T8 只需要：
1. Chat 功能改用 fetch 调用 `/v1/chat/completions`
2. 图片生成改用 `/v1/images/generations`
3. 保持相同的提示词逻辑
