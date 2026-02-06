
import React, { useState, useEffect, useRef } from 'react';
import { CanvasNode } from '../../types/pebblingTypes';
import { Icons } from './Icons';

interface ImageGenPanelProps {
  node: CanvasNode;
  /** Screen-space position for the panel (top-left corner) */
  position: { x: number; y: number };
  isLightCanvas: boolean;
  onUpdateSettings: (nodeId: string, settings: { aspectRatio?: string; resolution?: string }) => void;
  onUpdatePrompt: (nodeId: string, prompt: string) => void;
  onExecute: (nodeId: string) => void;
  onClose: () => void;
  isRunning: boolean;
}

const ASPECT_RATIOS_ROW1 = ['Auto', '1:1', '3:4', '4:3', '9:16', '16:9'];
const ASPECT_RATIOS_ROW2 = ['2:3', '3:2', '4:5', '5:4', '21:9'];
const RESOLUTIONS = ['1K', '2K', '4K'];

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({
  node,
  position,
  isLightCanvas,
  onUpdateSettings,
  onUpdatePrompt,
  onExecute,
  onClose,
  isRunning,
}) => {
  const settings = node.data?.settings || {};
  const currentRatio = settings.aspectRatio || 'Auto';
  const currentResolution = settings.resolution || '2K';
  const [localPrompt, setLocalPrompt] = useState(node.data?.prompt || '');
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync localPrompt when node changes
  useEffect(() => {
    setLocalPrompt(node.data?.prompt || '');
  }, [node.id, node.data?.prompt]);

  // Close on outside click - 使用延迟检测避免与节点选择冲突
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as HTMLElement)) {
        // 不要在点击画布节点时关闭（由 handleNodeDragStart 管理面板状态）
        const target = e.target as HTMLElement;
        if (target.closest?.('[data-node-id]')) return;
        // Save prompt before closing
        if (localPrompt !== (node.data?.prompt || '')) {
          onUpdatePrompt(node.id, localPrompt);
        }
        onClose();
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onClose, localPrompt, node.id, node.data?.prompt, onUpdatePrompt]);

  // Clamp position to viewport
  const panelW = 260;
  const panelH = 340;
  const clampedX = Math.min(position.x, window.innerWidth - panelW - 16);
  const clampedY = Math.max(60, Math.min(position.y, window.innerHeight - panelH - 16));

  const bg = isLightCanvas ? 'bg-white/95' : 'bg-[#1c1c1e]/95';
  const border = isLightCanvas ? 'border-gray-200' : 'border-white/10';
  const text = isLightCanvas ? 'text-gray-900' : 'text-white';
  const textMuted = isLightCanvas ? 'text-gray-500' : 'text-zinc-500';
  const inputBg = isLightCanvas ? 'bg-gray-100 border-gray-200 text-gray-800 placeholder-gray-400' : 'bg-black/40 border-white/10 text-white placeholder-zinc-600';

  const handleSetRatio = (ratio: string) => {
    onUpdateSettings(node.id, { ...settings, aspectRatio: ratio });
  };

  const handleSetResolution = (res: string) => {
    onUpdateSettings(node.id, { ...settings, resolution: res });
  };

  const handlePromptBlur = () => {
    if (localPrompt !== (node.data?.prompt || '')) {
      onUpdatePrompt(node.id, localPrompt);
    }
  };

  const handleExecute = () => {
    // Save prompt first
    if (localPrompt !== (node.data?.prompt || '')) {
      onUpdatePrompt(node.id, localPrompt);
    }
    onExecute(node.id);
  };

  return (
    <div
      ref={panelRef}
      className={`fixed z-[60] ${bg} backdrop-blur-xl border ${border} rounded-2xl shadow-2xl p-3 flex flex-col gap-2.5 animate-in fade-in slide-in-from-left-2 duration-200`}
      style={{
        left: clampedX,
        top: clampedY,
        width: panelW,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className={`flex items-center justify-between pb-1.5 border-b ${border}`}>
        <div className="flex items-center gap-2">
          <Icons.Image size={14} className="text-blue-400" />
          <span className={`text-xs font-bold ${text}`}>图片生成配置</span>
        </div>
        <button
          onClick={onClose}
          className={`w-5 h-5 rounded flex items-center justify-center ${isLightCanvas ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-white/10 text-zinc-500'}`}
        >
          <Icons.Close size={10} />
        </button>
      </div>

      {/* Prompt */}
      <div>
        <div className={`text-[10px] font-semibold mb-1 ${textMuted}`}>提示词</div>
        <textarea
          value={localPrompt}
          onChange={(e) => setLocalPrompt(e.target.value)}
          onBlur={handlePromptBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              handleExecute();
            }
          }}
          placeholder="描述想生成的画面..."
          className={`w-full rounded-lg p-2 text-[11px] outline-none resize-none border transition-colors ${inputBg} focus:border-blue-500/50`}
          rows={3}
        />
      </div>

      {/* Aspect Ratio */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[10px] font-semibold ${textMuted}`}>画面比例</span>
          <span className="text-[10px] font-mono font-semibold text-blue-400">{currentRatio}</span>
        </div>
        <div className="grid grid-cols-6 gap-0.5">
          {ASPECT_RATIOS_ROW1.map(ratio => (
            <button
              key={ratio}
              onClick={() => handleSetRatio(ratio)}
              className={`py-1 text-[9px] font-semibold rounded-md transition-all ${
                currentRatio === ratio
                  ? 'bg-blue-500 text-white shadow-sm'
                  : isLightCanvas
                    ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    : 'bg-white/5 text-zinc-500 hover:bg-white/10'
              }`}
            >
              {ratio}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-0.5 mt-0.5">
          {ASPECT_RATIOS_ROW2.map(ratio => (
            <button
              key={ratio}
              onClick={() => handleSetRatio(ratio)}
              className={`py-1 text-[9px] font-semibold rounded-md transition-all ${
                currentRatio === ratio
                  ? 'bg-blue-500 text-white shadow-sm'
                  : isLightCanvas
                    ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    : 'bg-white/5 text-zinc-500 hover:bg-white/10'
              }`}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      {/* Resolution */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[10px] font-semibold ${textMuted}`}>分辨率</span>
          <span className="text-[10px] font-mono font-semibold text-blue-400">{currentResolution}</span>
        </div>
        <div className="grid grid-cols-3 gap-0.5">
          {RESOLUTIONS.map(res => (
            <button
              key={res}
              onClick={() => handleSetResolution(res)}
              className={`py-1 text-[10px] font-semibold rounded-md transition-all ${
                currentResolution === res
                  ? 'bg-blue-500 text-white shadow-sm'
                  : isLightCanvas
                    ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    : 'bg-white/5 text-zinc-500 hover:bg-white/10'
              }`}
            >
              {res}
            </button>
          ))}
        </div>
      </div>

      {/* Execute Button */}
      <button
        onClick={handleExecute}
        disabled={isRunning}
        className={`w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
          isRunning
            ? 'bg-gray-500/20 text-gray-400 cursor-not-allowed'
            : 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/25 active:scale-[0.98]'
        }`}
      >
        {isRunning ? (
          <>
            <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            生成中...
          </>
        ) : (
          <>
            <Icons.Sparkles size={14} />
            生成图片
          </>
        )}
      </button>

      {/* Hint */}
      <div className={`text-[9px] text-center ${textMuted}`}>
        Ctrl+Enter 快速生成
      </div>
    </div>
  );
};

export default ImageGenPanel;
