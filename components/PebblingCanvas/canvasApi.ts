/**
 * PebblingCanvas API 适配器
 * 桥接主项目的 geminiService，提供画布专用的 AI 生成接口
 */

import { GenerationConfig } from '../../types/pebblingTypes';
import { editImageWithGemini, chatWithThirdPartyApi, getThirdPartyConfig, ImageEditConfig } from '../../services/geminiService';
import { base64ToFile } from './canvasUtils';
import type { ImageGenOptions } from './types';

// 检查API是否已配置（支持API或原生Gemini）
export const isApiConfigured = (): boolean => {
    const config = getThirdPartyConfig();
    const hasThirdParty = !!(config && config.enabled && config.apiKey);
    const hasGemini = !!localStorage.getItem('gemini_api_key');
    return hasThirdParty || hasGemini;
};

// 生成图片（文生图/图生图）- 自动选择API或Gemini；失败时返回 null
export const generateCreativeImage = async (
    prompt: string,
    config?: GenerationConfig,
    signal?: AbortSignal,
    options?: ImageGenOptions
): Promise<string | null> => {
    try {
        const imageConfig: ImageEditConfig = {
            aspectRatio: config?.aspectRatio || '1:1',
            imageSize: config?.resolution || '1K',
        };
        const result = await editImageWithGemini([], prompt, imageConfig);
        return result.imageUrl;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        options?.onError?.(msg);
        console.error('文生图失败:', e);
        return null;
    }
};

// 编辑图片（图生图）- 自动选择API或Gemini；失败时返回 null
export const editCreativeImage = async (
    images: string[],
    prompt: string,
    config?: GenerationConfig,
    signal?: AbortSignal,
    options?: ImageGenOptions
): Promise<string | null> => {
    try {
        console.log('[editCreativeImage] 开始处理, 输入图片数量:', images.length);
        console.log('[editCreativeImage] 图片格式预览:', images.map(img => ({
            prefix: img.slice(0, 50),
            length: img.length,
            isBase64: img.startsWith('data:image'),
            isHttpUrl: img.startsWith('http'),
            isLocalPath: img.startsWith('/files/')
        })));

        const files = await Promise.all(images.map(async (img, i) => {
            try {
                const file = await base64ToFile(img, `input_${i}.png`);
                console.log(`[editCreativeImage] 图片 ${i + 1} 转换成功:`, { name: file.name, size: file.size, type: file.type });
                return file;
            } catch (err) {
                console.error(`[editCreativeImage] 图片 ${i + 1} 转换失败:`, err);
                throw err;
            }
        }));

        const validFiles = files.filter(f => f.size > 0);
        console.log(`[editCreativeImage] 有效文件数: ${validFiles.length}/${files.length}`);
        if (validFiles.length === 0 && images.length > 0) {
            console.error('[editCreativeImage] 所有图片转换失败，退化为文生图');
        }

        const imageConfig: ImageEditConfig = {
            aspectRatio: config?.aspectRatio || 'Auto',
            imageSize: config?.resolution || '1K',
        };
        const result = await editImageWithGemini(validFiles, prompt, imageConfig);
        return result.imageUrl;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        options?.onError?.(msg);
        console.error('图生图失败:', e);
        return null;
    }
};

// 生成文本/扩写
export const generateCreativeText = async (content: string): Promise<{ title: string; content: string }> => {
    try {
        const systemPrompt = `You are a creative writing assistant. Expand and enhance the following content into a more detailed and vivid description. Output ONLY the enhanced text, no titles or explanations.`;
        const result = await chatWithThirdPartyApi(systemPrompt, content);
        const lines = result.split('\n').filter(l => l.trim());
        const title = lines[0]?.slice(0, 50) || '扩写内容';
        return { title, content: result };
    } catch (e) {
        console.error('文本生成失败:', e);
        return { title: '错误', content: String(e) };
    }
};

// LLM文本处理（与 pebblingGeminiService 签名对齐，maxTokens 可选）
export const generateAdvancedLLM = async (
    userPrompt: string,
    systemPrompt?: string,
    images?: string[],
    _maxTokens?: number
): Promise<string> => {
    try {
        const system = systemPrompt || 'You are a helpful assistant.';
        let imageFile: File | undefined;
        if (images && images.length > 0) {
            imageFile = await base64ToFile(images[0], 'input.png');
        }
        const result = await chatWithThirdPartyApi(system, userPrompt, imageFile);
        return result;
    } catch (e) {
        console.error('LLM处理失败:', e);
        return `错误: ${e}`;
    }
};
