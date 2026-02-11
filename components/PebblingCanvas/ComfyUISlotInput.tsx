/**
 * ComfyUISlotInput - ComfyUI 工作流参数输入组件
 * IMAGE 类型显示上传/创意库选择，其余为文本/数字/布尔输入
 */

import React, { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { comfyuiUploadImage } from '../../services/api/comfyui';
import { Icons } from './Icons';
import CustomSelect from './CustomSelect';

export interface ComfyUISlotInputProps {
    slot: { slotKey: string; label: string; type: string; description?: string; nodeId?: string; inputName?: string };
    value: string;
    onChange: (v: string) => void;
    comfyBaseUrl: string;
    creativeIdeas?: Array<{ id: number; title: string; imageUrl: string }>;
    isLightCanvas: boolean;
    themeColors: { inputBg: string; inputBorder: string; textPrimary: string; textMuted: string; textSecondary: string };
    onMouseDown: (e: React.MouseEvent) => void;
}

const ComfyUISlotInput: React.FC<ComfyUISlotInputProps> = ({ slot, value, onChange, comfyBaseUrl, creativeIdeas, isLightCanvas, themeColors, onMouseDown }) => {
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isImage = slot.type === 'IMAGE';

    const uploadImageToComfy = async (base64: string) => {
        if (!comfyBaseUrl.trim()) {
            setUploadError('请先选择 ComfyUI 地址');
            return;
        }
        setUploadError(null);
        setUploading(true);
        try {
            const res = await comfyuiUploadImage(base64, comfyBaseUrl);
            if (res.success && res.name) {
                onChange(res.name);
            } else {
                setUploadError(res.error || '上传失败');
            }
        } catch (e: unknown) {
            setUploadError(e instanceof Error ? e.message : '上传异常');
        } finally {
            setUploading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        e.target.value = '';
        const reader = new FileReader();
        reader.onload = () => {
            const data = reader.result as string;
            if (data.startsWith('data:')) uploadImageToComfy(data);
        };
        reader.readAsDataURL(file);
    };

    const handleSelectFromLibrary = async (imageUrl: string) => {
        if (!imageUrl) return;
        setUploadError(null);
        setUploading(true);
        try {
            let url = imageUrl;
            if (url.startsWith('/') && !url.startsWith('//')) {
                url = `${window.location.origin}${url}`;
            }
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const reader = new FileReader();
            reader.onload = () => uploadImageToComfy(reader.result as string);
            reader.readAsDataURL(blob);
        } catch (e: unknown) {
            setUploadError(e instanceof Error ? e.message : '获取图片失败');
            setUploading(false);
        }
    };

    if (isImage) {
        const previewUrl = value && comfyBaseUrl
            ? `/api/comfyui/view?${new URLSearchParams({ baseUrl: comfyBaseUrl, filename: value, subfolder: '', type: 'input' }).toString()}`
            : '';
        const showPlaceholder = !value || !previewUrl;

        return (
            <div className="space-y-1.5" onMouseDown={onMouseDown}>
                <label className="text-[9px] break-words" style={{ color: themeColors.textMuted }}>{slot.label}</label>
                <div className={`flex flex-col items-center justify-center gap-2 rounded-lg py-2 ${isLightCanvas ? 'bg-gray-100/80' : 'bg-white/5'}`}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                    {showPlaceholder ? (
                        <>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: isLightCanvas ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }}>
                                <Icons.Image size={16} style={{ color: themeColors.textMuted }} />
                            </div>
                            <span className={`text-[9px] font-medium uppercase tracking-wide ${isLightCanvas ? 'text-gray-500' : 'text-zinc-500'}`}>
                                上传或输入提示词
                            </span>
                        </>
                    ) : (
                        <div className="w-full min-h-[60px] max-h-24 rounded-lg overflow-hidden bg-black/20 flex items-center justify-center">
                            <img
                                src={previewUrl}
                                alt="预览"
                                className="max-w-full max-h-24 w-auto h-auto object-contain"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    const fallback = (e.target as HTMLImageElement).nextElementSibling;
                                    if (fallback) (fallback as HTMLElement).style.display = 'flex';
                                }}
                            />
                            <div className="hidden w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: isLightCanvas ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }}>
                                <Icons.Image size={16} style={{ color: themeColors.textMuted }} />
                            </div>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <button
                            type="button"
                            disabled={uploading || !comfyBaseUrl}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium border border-blue-500/20 transition-colors disabled:opacity-50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload size={10} />
                            {uploading ? '上传中...' : '上传'}
                        </button>
                        {creativeIdeas && creativeIdeas.length > 0 && (
                            <CustomSelect
                                options={['— 从创意库选择 —', ...creativeIdeas.map((i) => i.title)]}
                                value="— 从创意库选择 —"
                                onChange={(title) => {
                                    if (title === '— 从创意库选择 —') return;
                                    const idea = creativeIdeas.find((i) => i.title === title);
                                    if (idea) handleSelectFromLibrary(idea.imageUrl);
                                }}
                                isLightCanvas={isLightCanvas}
                                themeColors={themeColors}
                            />
                        )}
                    </div>
                    {value && (
                        <span className="text-[9px] truncate max-w-full block px-1" style={{ color: themeColors.textMuted }} title={value}>
                            已选: {value}
                        </span>
                    )}
                    {uploadError && (
                        <span className="text-[9px]" style={{ color: '#f87171' }}>{uploadError}</span>
                    )}
                </div>
            </div>
        );
    }

    // 非 IMAGE：占位符用 slot.description 或按类型默认
    const placeholderByType = slot.description ?? (slot.type === 'INT' ? '输入整数' : slot.type === 'FLOAT' ? '输入小数' : slot.type === 'BOOLEAN' ? 'true / false' : '输入文本');

    if (slot.type === 'BOOLEAN') {
        return (
            <div className="space-y-1 min-w-0" onMouseDown={onMouseDown}>
                <label className="text-[9px] break-words" style={{ color: themeColors.textMuted }}>{slot.label} <span className="opacity-70">(BOOLEAN)</span></label>
                <CustomSelect
                    options={['true', 'false']}
                    value={value === 'true' || value === 'false' ? value : 'true'}
                    onChange={(v) => onChange(v)}
                    isLightCanvas={isLightCanvas}
                    themeColors={themeColors}
                />
            </div>
        );
    }

    if (slot.type === 'INT') {
        return (
            <div className="space-y-1 min-w-0" onMouseDown={onMouseDown}>
                <label className="text-[9px] break-words" style={{ color: themeColors.textMuted }}>{slot.label} <span className="opacity-70">(INT)</span></label>
                <input
                    type="number"
                    step={1}
                    inputMode="numeric"
                    className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                    style={{ backgroundColor: themeColors.inputBg, border: `1px solid ${themeColors.inputBorder}`, color: themeColors.textPrimary }}
                    placeholder={placeholderByType}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v === '' || v === '-') {
                            onChange(v);
                            return;
                        }
                        const n = parseInt(v, 10);
                        if (!Number.isNaN(n)) onChange(String(n));
                        else onChange('');
                    }}
                />
            </div>
        );
    }

    if (slot.type === 'FLOAT') {
        return (
            <div className="space-y-1 min-w-0" onMouseDown={onMouseDown}>
                <label className="text-[9px] break-words" style={{ color: themeColors.textMuted }}>{slot.label} <span className="opacity-70">(FLOAT)</span></label>
                <input
                    type="number"
                    step="any"
                    className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                    style={{ backgroundColor: themeColors.inputBg, border: `1px solid ${themeColors.inputBorder}`, color: themeColors.textPrimary }}
                    placeholder={placeholderByType}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            </div>
        );
    }

    // STRING：与 IMAGE 节点底部提示词输入一致的设计（textarea）
    return (
        <div className="space-y-1 min-w-0" onMouseDown={onMouseDown}>
            <label className="text-[9px] break-words" style={{ color: themeColors.textMuted }}>{slot.label} <span className="opacity-70">(STRING)</span></label>
            <textarea
                rows={2}
                className={`w-full rounded-lg p-2 text-[10px] outline-none resize-none transition-colors ${isLightCanvas ? 'bg-gray-100 border border-gray-200 text-gray-700 placeholder-gray-400 focus:border-blue-400' : 'bg-black/50 border border-white/10 text-zinc-300 placeholder-zinc-600 focus:border-blue-500/50 focus:text-white'}`}
                style={{ borderColor: isLightCanvas ? undefined : themeColors.inputBorder, color: themeColors.textPrimary }}
                placeholder={placeholderByType}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
};

export default ComfyUISlotInput;
