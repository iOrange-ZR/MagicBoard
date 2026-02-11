/**
 * PebblingCanvas 工具函数
 * 纯函数，不依赖 React 或组件状态
 */

import { CanvasNode } from '../../types/pebblingTypes';
import { WorkflowNode, WorkflowNodeType } from '../../types';
import type { ImageMetadata } from './types';

/** 画布节点类型中与创意库 WorkflowNode 兼容的子集 */
const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = ['text', 'image', 'edit', 'video', 'llm', 'resize', 'relay', 'remove-bg', 'upscale'];

// 生成简短唯一ID
export const uuid = () => Math.random().toString(36).substr(2, 9);

// 检查是否是有效的视频数据
export const isValidVideo = (content: string | undefined): boolean => {
    if (!content || content.length < 10) return false;
    return (
        content.startsWith('data:video') ||
        content.startsWith('http://') ||
        content.startsWith('https://') ||
        content.startsWith('//') ||
        content.startsWith('/files/')
    );
};

// 检查是否是有效的图片数据
export const isValidImage = (content: string | undefined): boolean => {
    if (!content || content.length < 10) return false;
    return (
        content.startsWith('data:image') ||
        content.startsWith('http://') ||
        content.startsWith('https://') ||
        content.startsWith('//') ||
        content.startsWith('/files/') ||
        content.startsWith('/api/')
    );
};

// base64 转 File - 支持多种图片格式
export const base64ToFile = async (imageUrl: string, filename: string = 'image.png'): Promise<File> => {
    try {
        // 1. 如果是 data:image base64 格式，直接 fetch
        if (imageUrl.startsWith('data:image')) {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            return new File([blob], filename, { type: blob.type || 'image/png' });
        }

        // 2. 如果是本地路径 /files/xxx，需要通过 API 转换
        if (imageUrl.startsWith('/files/') || imageUrl.startsWith('/api/')) {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            return new Promise((resolve, reject) => {
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(new File([blob], filename, { type: 'image/png' }));
                        } else {
                            reject(new Error('图片转换失败'));
                        }
                    }, 'image/png');
                };
                img.onerror = () => reject(new Error(`图片加载失败: ${imageUrl.slice(0, 100)}`));
                img.src = imageUrl;
            });
        }

        // 3. 如果是 HTTP/HTTPS URL，通过 canvas 转换避免 CORS 问题
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('//')) {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            return new Promise((resolve, reject) => {
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(new File([blob], filename, { type: 'image/png' }));
                        } else {
                            reject(new Error('图片转换失败'));
                        }
                    }, 'image/png');
                };
                img.onerror = () => {
                    console.error('[base64ToFile] 图片加载失败，可能是 CORS 问题:', imageUrl.slice(0, 100));
                    reject(new Error(`图片加载失败(CORS): ${imageUrl.slice(0, 100)}`));
                };
                img.src = imageUrl;
            });
        }

        // 4. 其他格式，尝试直接 fetch
        console.warn('[base64ToFile] 未知格式，尝试直接 fetch:', imageUrl.slice(0, 50));
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        return new File([blob], filename, { type: blob.type || 'image/png' });
    } catch (error) {
        console.error('[base64ToFile] 转换失败:', error, 'URL:', imageUrl.slice(0, 100));
        throw error;
    }
};

// 🔥 提取图片元数据(宽高/大小/格式)
export const extractImageMetadata = async (imageUrl: string): Promise<ImageMetadata> => {
    return new Promise((resolve, _reject) => {
        const img = new Image();

        img.onload = () => {
            const width = img.naturalWidth;
            const height = img.naturalHeight;

            // 提取格式
            let format = 'UNKNOWN';
            if (imageUrl.startsWith('data:image/')) {
                const match = imageUrl.match(/data:image\/(\w+);/);
                format = match ? match[1].toUpperCase() : 'BASE64';
            } else if (imageUrl.includes('.')) {
                const ext = imageUrl.split('.').pop()?.split('?')[0];
                format = ext ? ext.toUpperCase() : 'URL';
            }

            // 计算大小
            let size = 'Unknown';
            if (imageUrl.startsWith('data:')) {
                const base64Length = imageUrl.split(',')[1]?.length || 0;
                const bytes = (base64Length * 3) / 4;
                if (bytes < 1024) {
                    size = `${Math.round(bytes)} B`;
                } else if (bytes < 1024 * 1024) {
                    size = `${(bytes / 1024).toFixed(1)} KB`;
                } else {
                    size = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
                }
            }

            resolve({ width, height, size, format });
        };

        img.onerror = () => {
            console.warn('[extractImageMetadata] 图片加载失败:', imageUrl.slice(0, 100));
            resolve({ width: 0, height: 0, size: 'Unknown', format: 'Unknown' });
        };

        img.src = imageUrl;
    });
};

// Client-Side 图片 Resize
export const resizeImageClient = (base64Str: string, mode: 'longest' | 'shortest' | 'width' | 'height' | 'exact', widthVal: number, heightVal: number): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let currentW = img.width;
            let currentH = img.height;
            let newWidth = currentW;
            let newHeight = currentH;
            const aspectRatio = currentW / currentH;

            if (mode === 'exact') {
                newWidth = widthVal;
                newHeight = heightVal;
            } else if (mode === 'width') {
                newWidth = widthVal;
                newHeight = widthVal / aspectRatio;
            } else if (mode === 'height') {
                newHeight = heightVal;
                newWidth = heightVal * aspectRatio;
            } else if (mode === 'longest') {
                const target = widthVal;
                if (currentW > currentH) {
                    newWidth = target;
                    newHeight = target / aspectRatio;
                } else {
                    newHeight = target;
                    newWidth = target * aspectRatio;
                }
            } else if (mode === 'shortest') {
                const target = widthVal;
                if (currentW < currentH) {
                    newWidth = target;
                    newHeight = target / aspectRatio;
                } else {
                    newHeight = target;
                    newWidth = target * aspectRatio;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = newWidth;
            canvas.height = newHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, newWidth, newHeight);
                resolve(canvas.toDataURL(base64Str.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.92));
            } else {
                reject("Canvas context error");
            }
        };
        img.onerror = reject;
        img.src = base64Str;
    });
};

/** BP 智能体输出截断：取首句或前 maxLen 字，避免长段扩写进入图生提示词 */
export function truncateAgentResultForPrompt(raw: string, maxLen: number): string {
    if (!raw || raw.length <= maxLen) return raw;
    const sentenceEnd = raw.match(/[。！？.!?]\s*/);
    const firstSentence = sentenceEnd ? raw.slice(0, (sentenceEnd.index ?? 0) + 1) : raw.slice(0, maxLen);
    return (firstSentence.length > maxLen ? firstSentence.slice(0, maxLen) : firstSentence).trim();
}

/** 将画布节点转换为工作流节点 */
export function canvasNodeToWorkflowNode(n: CanvasNode): WorkflowNode {
    const type = (WORKFLOW_NODE_TYPES.includes(n.type as WorkflowNodeType) ? n.type : 'relay') as WorkflowNodeType;
    return {
        id: n.id,
        type,
        title: n.title,
        content: n.content ?? '',
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        data: n.data ? { prompt: n.data.prompt, systemInstruction: n.data.systemInstruction, settings: n.data.settings } : undefined,
    };
}
