/**
 * 前端创意提取器
 * 用于从前端获取并提取创意数据
 */

interface CreativeRecord {
  id: number;
  title: string;
  prompts: string[];
  images: string[];
  [key: string]: any;
}

interface FormattedCreative {
  order: number;
  title: string;
  author: string;
  prompt: string;
  imageUrl: string;
  isSmart: boolean;
  isSmartPlus: boolean;
  isBP: boolean;
  allowViewPrompt: boolean;
  allowEditPrompt: boolean;
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractOptions {
  url: string;
  idRange: string;
  onProgress?: (current: number, total: number, record: any) => void;
}

class CreativeExtractor {
  private timeout = 30000;
  private imageTimeout = 15000;

  /**
   * 从URL获取JSON数据
   * @param url - 数据源URL
   * @returns 数据数组
   */
  async fetchData(url: string): Promise<any[]> {
    // 检查URL是否有效
    try {
      new URL(url);
    } catch (error) {
      throw new Error('无效的URL格式');
    }
    
    // 为了处理CORS问题，通过后端代理请求外部数据
    // 确保URL被正确编码
    const encodedUrl = encodeURIComponent(url);
    const proxyUrl = `/api/creative-ideas/external-data?url=${encodedUrl}`;
    
    const response = await fetch(proxyUrl, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('请求的资源不存在，请检查URL是否正确');
      } else if (response.status === 403) {
        throw new Error('访问被拒绝，请检查URL权限');
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || '获取数据失败');
    }
    
    const data = result.data;

    // 如果是对象，提取列表
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // 检查是否有items字段（如opennana网站）
      if (Array.isArray(data.items) && data.items.length > 0) {
        return data.items;
      }
      
      // 否则遍历所有键查找数组
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          return data[key];
        }
      }
    }

    if (!Array.isArray(data)) {
      throw new Error('数据格式错误：期望数组格式');
    }

    return data;
  }

  /**
   * 解析ID范围
   * @param idInput - ID输入 (如 "791-785" 或 "id791-785")
   * @returns { start: number, end: number } | null
   */
  parseIdRange(idInput: string): { start: number; end: number } | null {
    if (!idInput) return null;

    // 去除空格和"id"前缀
    let cleaned = idInput.toString().trim().toLowerCase().replace(/^id/, '');
    if (cleaned.includes('-')) {
      const [a, b] = cleaned.split('-').map(s => parseInt(s.trim(), 10));
      if (isNaN(a) || isNaN(b)) return null;
      return { start: Math.max(a, b), end: Math.min(a, b) };
    } else {
      const id = parseInt(cleaned, 10);
      if (isNaN(id)) return null;
      return { start: id, end: id };
    }
  }

  /**
   * 从JSON URL提取base URL
   * 例如: https://opennana.com/awesome-prompt-gallery/data/prompts.json
   * 返回: https://opennana.com/awesome-prompt-gallery/
   * @param jsonUrl
   * @returns
   */
  extractBaseUrl(jsonUrl: string): string {
    if (!jsonUrl) return '';
    const url = new URL(jsonUrl);
    // 移除最后两段 (data/prompts.json)
    const pathParts = url.pathname.split('/').filter(p => p);
    if (pathParts.length >= 2) {
      pathParts.pop(); // 移除文件名
      pathParts.pop(); // 移除 data 目录
      const newPath = pathParts.length > 0 ? '/' + pathParts.join('/') + '/' : '/';
      return `${url.protocol}//${url.host}${newPath}`;
    }
    return `${url.protocol}//${url.host}/`;
  }

  /**
   * 将图片URL转换为Base64
   * @param imageUrl - 图片URL
   * @param baseUrl - 基础URL
   * @returns Base64字符串
   */
  async downloadImageAsBase64(imageUrl: string, baseUrl: string): Promise<string> {
    let fullUrl = imageUrl;
    
    // 如果是相对路径，拼接基础URL
    if (imageUrl && !imageUrl.startsWith('http')) {
      fullUrl = `${baseUrl}${imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl}`;
    }

    if (!fullUrl) {
      // 返回一个默认图片的base64
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjMkQyRDJEIi8+Cjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2RjZGN0YiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4K';
    }

    try {
      const response = await fetch(fullUrl, {
        signal: AbortSignal.timeout(this.imageTimeout)
      });

      if (!response.ok) {
        throw new Error(`图片下载失败: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const reader = new FileReader();
      
      return new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn(`图片下载失败: ${fullUrl}`, error);
      // 返回一个默认图片的base64
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjMkQyRDJEIi8+Cjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2RjZGN0YiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4K';
    }
  }

  /**
   * 转换记录为标准格式
   * @param record - 原始记录
   * @param base64Image - Base64图片数据
   * @returns 标准格式记录
   */
  formatRecord(record: any, base64Image: string): FormattedCreative {
    const now = new Date().toISOString();

    // 处理 prompts 字段
    let prompt = '';
    if (Array.isArray(record.prompts) && record.prompts.length > 0) {
      // 将所有prompts合并为一个字符串
      prompt = record.prompts.join('\n\n');
    } else if (record.prompt) {
      prompt = record.prompt;
    }

    // 从source字段提取作者信息
    let author = record.author || '';
    if (!author && record.source && record.source.name) {
      // 移除@符号
      author = record.source.name.replace(/^@/, '');
    }

    return {
      order: record.order ?? record.id,
      title: record.title || '',
      author: author,
      prompt: prompt,
      imageUrl: base64Image,
      isSmart: record.isSmart ?? false,
      isSmartPlus: record.isSmartPlus ?? false,
      isBP: record.isBP ?? false,
      allowViewPrompt: record.allowViewPrompt ?? true,
      allowEditPrompt: record.allowEditPrompt ?? true,
      id: record.id,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * 主提取方法
   * @param options - 提取选项
   * @returns 提取并格式化后的记录数组
   */
  async extract(options: ExtractOptions): Promise<FormattedCreative[]> {
    const { url, idRange, onProgress } = options;
    
    if (!url) throw new Error('请提供数据URL');
    if (!idRange) throw new Error('请提供ID范围');

    // 解析ID范围
    const range = this.parseIdRange(idRange);
    if (!range) throw new Error('ID范围格式错误');

    // 获取数据
    const data = await this.fetchData(url);
    console.log(`✅ 成功获取 ${data.length} 条记录`);

    // 筛选ID范围内的记录
    const filtered = data.filter((record: any) => {
      const id = record.id;
      return id !== undefined && id >= range.end && id <= range.start;
    });

    // 按ID降序排序
    filtered.sort((a: any, b: any) => b.id - a.id);
    console.log(`🎯 筛选出 ${filtered.length} 条记录(ID ${range.start} 到 ${range.end})`);

    if (filtered.length === 0) {
      return [];
    }

    // 提取base URL
    const baseUrl = this.extractBaseUrl(url);

    // 处理每条记录
    const results: FormattedCreative[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const record = filtered[i];

      if (onProgress) {
        onProgress(i + 1, filtered.length, record);
      }

      // 获取图片URL
      let imageUrl = '';
      if (Array.isArray(record.images) && record.images.length > 0) {
        imageUrl = record.images[0];
      } else if (record.imageUrl) {
        imageUrl = record.imageUrl;
      }

      // 下载图片并转换为Base64
      console.log(`🔄 处理第 ${i + 1}/${filtered.length} 条(ID: ${record.id})`);
      const base64Image = await this.downloadImageAsBase64(imageUrl, baseUrl);

      // 格式化记录
      const formatted = this.formatRecord(record, base64Image);
      results.push(formatted);
    }

    console.log(`✅ 完成，共处理 ${results.length} 条记录`);
    return results;
  }
}

// 快捷提取方法
export async function extractCreatives(options: ExtractOptions): Promise<FormattedCreative[]> {
  const extractor = new CreativeExtractor();
  return extractor.extract(options);
}

// 保存结果到文件（前端使用下载方式）
export async function saveToFile(data: any, filename: string): Promise<void> {
  const dataStr = JSON.stringify(data, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default CreativeExtractor;