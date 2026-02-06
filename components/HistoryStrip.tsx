import React, { useRef, useState, useCallback, useEffect } from 'react';
import { GenerationHistory } from '../types';
import { Trash2 as TrashIcon, Clock as ClockIcon, ChevronLeft, ChevronRight, Check, Video as VideoIcon } from 'lucide-react';
import { normalizeImageUrl } from '../utils/image';

// 🔧 检测是否为视频URL
const isVideoUrl = (url: string): boolean => {
  if (!url) return false;
  return url.includes('.mp4') || url.includes('.webm') || url.startsWith('data:video');
};

interface HistoryStripProps {
  history: GenerationHistory[];
  onSelect: (item: GenerationHistory) => void;
  onDelete: (id: number) => void;
  onClear: () => void;
  selectedId?: number | null;
}

export const HistoryStrip: React.FC<HistoryStripProps> = ({ 
  history, 
  onSelect, 
  onDelete,
  onClear,
  selectedId
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(true);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  // 更新渐变遮罩显示状态
  const updateFadeState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    setShowLeftFade(container.scrollLeft > 10);
    setShowRightFade(
      container.scrollLeft < container.scrollWidth - container.clientWidth - 10
    );
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    updateFadeState();
    container.addEventListener('scroll', updateFadeState);
    window.addEventListener('resize', updateFadeState);
    
    return () => {
      container.removeEventListener('scroll', updateFadeState);
      window.removeEventListener('resize', updateFadeState);
    };
  }, [updateFadeState, history.length]);

  // 鼠标拖拽滚动
  const handleMouseDown = (e: React.MouseEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    setIsDragging(true);
    setStartX(e.pageX - container.offsetLeft);
    setScrollLeft(container.scrollLeft);
    container.style.cursor = 'grabbing';
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 2; // 滚动速度倍率
    container.scrollLeft = scrollLeft - walk;
  }, [isDragging, startX, scrollLeft]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    const container = scrollContainerRef.current;
    if (container) {
      container.style.cursor = 'grab';
    }
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // 滚轮横向滚动
  const handleWheel = (e: React.WheelEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    // 如果是水平滚动，使用默认行为
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    
    // 将垂直滚动转换为水平滚动
    e.preventDefault();
    container.scrollLeft += e.deltaY;
  };

  // 平滑滚动到指定位置
  const smoothScroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const scrollAmount = 300;
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  if (history.length === 0) {
    return null; // 没有历史记录时不显示
  }

  return (
    <div className="w-full">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3 px-2">
        <div className="flex items-center gap-2">
          <ClockIcon className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-300">历史生图</span>
          <span className="text-xs text-gray-500">({history.length})</span>
        </div>
        <button
          onClick={onClear}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
        >
          <TrashIcon className="w-3 h-3" />
          清空
        </button>
      </div>
      
      {/* 滚动容器 */}
      <div className="relative group/strip">
        {/* 左侧渐变遮罩 + 滚动按钮 */}
        <div 
          className={`absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-gray-950 to-transparent z-10 pointer-events-none transition-opacity duration-300 ${
            showLeftFade ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {showLeftFade && (
          <button
            onClick={() => smoothScroll('left')}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-blue-600/80 hover:border-blue-500/50 transition-all opacity-0 group-hover/strip:opacity-100"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        {/* 右侧渐变遮罩 + 滚动按钮 */}
        <div 
          className={`absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-gray-950 to-transparent z-10 pointer-events-none transition-opacity duration-300 ${
            showRightFade ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {showRightFade && (
          <button
            onClick={() => smoothScroll('right')}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-blue-600/80 hover:border-blue-500/50 transition-all opacity-0 group-hover/strip:opacity-100"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* 历史记录卡片容器 */}
        <div
          ref={scrollContainerRef}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 px-2"
          style={{ 
            cursor: isDragging ? 'grabbing' : 'grab',
            scrollBehavior: isDragging ? 'auto' : 'smooth',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {history.map((item) => (
            <div
              key={item.id}
              onClick={() => !isDragging && onSelect(item)}
              className={`group relative flex-shrink-0 w-28 transition-all duration-300 ${
                selectedId === item.id 
                  ? 'scale-105' 
                  : 'hover:scale-105'
              }`}
            >
              {/* 图片卡片 */}
              <div 
                className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all duration-300 shadow-lg ${
                  selectedId === item.id 
                    ? 'border-blue-500 shadow-blue-500/30' 
                    : 'border-white/10 hover:border-blue-500/50 hover:shadow-blue-500/20'
                }`}
              >
                {/* 🔧 视频显示图标，图片正常加载 */}
                {isVideoUrl(item.imageUrl) ? (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/60 to-gray-900">
                    <VideoIcon className="w-8 h-8 text-purple-300" />
                  </div>
                ) : (
                  <img
                    src={normalizeImageUrl(item.imageUrl)}
                    alt={`生成于 ${formatTime(item.timestamp)}`}
                    className="w-full h-full object-cover"
                    draggable={false}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2NjY2NjYiIHN0cm9rZS13aWR0aD0iMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiLz48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSIvPjxwb2x5bGluZSBwb2ludHM9IjIxIDE1IDEwIDkgMyAxNSIvPjwvc3ZnPg==';
                    }}
                  />
                )}
                
                {/* 悬停遮罩 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {/* 提示词预览 */}
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[10px] text-white/90 line-clamp-2 leading-tight">
                      {item.prompt.length > 40 ? item.prompt.slice(0, 40) + '...' : item.prompt}
                    </p>
                  </div>
                </div>
                
                {/* 模型标识 */}
                <div className="absolute top-1.5 left-1.5">
                  <span className={`w-2 h-2 rounded-full block shadow-lg ${
                    item.isThirdParty ? 'bg-blue-500 shadow-blue-500/50' : 'bg-blue-500 shadow-blue-500/50'
                  }`}></span>
                </div>
                
                {/* 删除按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                  className="absolute bottom-1.5 right-1.5 p-1.5 bg-gray-500/80 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-gray-600 hover:scale-110"
                >
                  <TrashIcon className="w-3 h-3 text-white" />
                </button>
                
                {/* 选中指示器 */}
                {selectedId === item.id && (
                  <div className="absolute inset-0 border-2 border-blue-500 rounded-xl pointer-events-none">
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" fill="currentColor" />
                    </div>
                  </div>
                )}
              </div>
              
              {/* 时间标签 */}
              <p className="text-[10px] text-gray-500 text-center mt-1.5 truncate">
                {formatTime(item.timestamp)}
              </p>
            </div>
          ))}
        </div>
      </div>
      
      {/* 隐藏滚动条的样式 */}
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};
