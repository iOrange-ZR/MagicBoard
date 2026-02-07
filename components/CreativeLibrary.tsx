

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { CreativeIdea, CreativeCategoryType } from '../types';
import { CREATIVE_CATEGORIES } from '../types';
import { PlusCircle as PlusCircleIcon, Trash2 as TrashIcon, Library as LibraryIcon, Edit as EditIcon, Download as UploadIcon, Upload as DownloadIcon, TrendingUp, Clipboard, Check, Star, Search as SearchIconLucide, FolderOpen, Layers, Sparkles, Loader2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { normalizeImageUrl } from '../utils/image';
import { ImportCreativeModal } from './ImportCreativeModal';
import { autoClassifyCreative } from '../services/geminiService';
import { useVirtualizer } from '@tanstack/react-virtual';

// 虚拟化网格配置
const CARD_MIN_SIZE = 140; // 卡片最小尺寸
const CARD_GAP = 12; // 卡片间距
const GRID_PADDING = 12; // 网格内边距

// 计算列数和卡片尺寸
const calculateGridDimensions = (containerWidth: number) => {
  if (containerWidth <= 0) return { columnCount: 1, cardSize: CARD_MIN_SIZE };
  const availableWidth = containerWidth - GRID_PADDING * 2;
  const columnCount = Math.max(1, Math.floor((availableWidth + CARD_GAP) / (CARD_MIN_SIZE + CARD_GAP)));
  const cardSize = Math.floor((availableWidth - (columnCount - 1) * CARD_GAP) / columnCount);
  return { columnCount, cardSize: Math.max(cardSize, CARD_MIN_SIZE) };
};

// 虚拟化网格组件的 Props
interface VirtualizedCreativeGridProps {
  ideas: CreativeIdea[];
  selectedIds: Set<number>;
  isMultiSelectMode: boolean;
  sortBy: string;
  isLight: boolean;
  theme: any;
  searchTerm: string;
  filter: string;
  categoryFilter: string;
  onToggleSelect: (id: number) => void;
  onUse: (idea: CreativeIdea) => void;
  onEdit: (idea: CreativeIdea) => void;
  onDelete: (id: number) => void;
  onToggleFavorite?: (id: number) => void;
  onExportSingle: (idea: CreativeIdea) => void;
  dragItem: React.MutableRefObject<CreativeIdea | null>;
  dragOverItem: React.MutableRefObject<CreativeIdea | null>;
  onDragSort: () => void;
}

// 单个卡片组件 - 用于虚拟列表渲染
const CreativeCard: React.FC<{
  idea: CreativeIdea;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  sortBy: string;
  isLight: boolean;
  theme: any;
  style: React.CSSProperties;
  onToggleSelect: (id: number) => void;
  onUse: (idea: CreativeIdea) => void;
  onEdit: (idea: CreativeIdea) => void;
  onDelete: (id: number) => void;
  onToggleFavorite?: (id: number) => void;
  onExportSingle: (idea: CreativeIdea) => void;
  dragItem: React.MutableRefObject<CreativeIdea | null>;
  dragOverItem: React.MutableRefObject<CreativeIdea | null>;
  onDragSort: () => void;
}> = React.memo(({ idea, isSelected, isMultiSelectMode, sortBy, isLight, theme, style, onToggleSelect, onUse, onEdit, onDelete, onToggleFavorite, onExportSingle, dragItem, dragOverItem, onDragSort }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 画布流程且无缩略图时，不依赖图片加载，直接显示占位，避免一直转圈
  const hasPreviewImage = !idea.isWorkflow || !!(idea.imageUrl && idea.imageUrl.trim() && normalizeImageUrl(idea.imageUrl));

  // 单击打开编辑，双击快速收藏（延迟执行单击以区分双击）
  const handleCardClick = () => {
    if (isMultiSelectMode) {
      onToggleSelect(idea.id);
      return;
    }
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = setTimeout(() => {
      clickTimeoutRef.current = null;
      onEdit(idea);
    }, 250);
  };
  const handleCardDoubleClick = () => {
    if (isMultiSelectMode) return;
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    onToggleFavorite?.(idea.id);
  };

  return (
    <div style={style}>
      <div
        className={`group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 ${
          isSelected ? 'ring-2 ring-purple-500 ring-offset-2' : ''
        }`}
        style={{
          background: theme.colors.bgSecondary,
          border: `1px solid ${isSelected ? 'rgb(147,51,234)' : theme.colors.border}`,
          width: '100%',
          height: '100%',
        }}
        title={idea.title}
        onClick={handleCardClick}
        onDoubleClick={handleCardDoubleClick}
        draggable={!isMultiSelectMode && sortBy === 'manual'}
        onDragStart={() => (dragItem.current = idea)}
        onDragEnter={() => (dragOverItem.current = idea)}
        onDragEnd={onDragSort}
        onDragOver={(e) => e.preventDefault()}
      >
        {/* 多选模式下的复选框 */}
        {isMultiSelectMode && (
          <div
            className={`absolute top-2 left-2 w-5 h-5 rounded-md border-2 flex items-center justify-center z-10 transition-all duration-200 ${
              isSelected
                ? 'bg-purple-500 border-purple-500'
                : 'bg-black/40 border-white/60 hover:border-purple-400'
            }`}
          >
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </div>
        )}

        {/* 图片懒加载：仅在有预览图且未加载完时显示转圈；画布流程无图时显示占位 */}
        {hasPreviewImage && !imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-700">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        )}
        {!hasPreviewImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
            <Layers className="w-10 h-10 mb-1.5 opacity-80" />
            <span className="text-xs font-medium">画布流程</span>
            <span className="text-[10px] mt-0.5">
              {idea.workflowNodes?.length ?? 0} 节点
            </span>
          </div>
        )}
        {hasPreviewImage && (
          <img
            src={normalizeImageUrl(idea.imageUrl)}
            alt={idea.title}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={`w-full h-full object-contain transition-transform duration-500 group-hover:scale-105 p-0.5 pointer-events-none ${
              isSelected ? 'opacity-80' : ''
            } ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        {/* 底部信息 */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent pointer-events-none transition-all duration-300 group-hover:from-black/98 group-hover:via-black/85">
          <div className="p-2 pb-1.5">
            <h3 className="font-semibold text-white truncate text-xs">{idea.title}</h3>
          </div>
          <div className="max-h-0 overflow-hidden group-hover:max-h-24 transition-all duration-300 px-2 pb-2">
            {idea.isBP && idea.bpFields && idea.bpFields.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {idea.bpFields.slice(0, 4).map((field, i) => (
                  <span key={i} className="text-[9px] text-zinc-300 bg-white/10 px-1.5 py-0.5 rounded">
                    {field.label}
                  </span>
                ))}
                {idea.bpFields.length > 4 && (
                  <span className="text-[9px] text-zinc-400">+{idea.bpFields.length - 4}</span>
                )}
              </div>
            )}
            {idea.isWorkflow && idea.workflowInputs && idea.workflowInputs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {idea.workflowInputs.slice(0, 4).map((input, i) => (
                  <span key={i} className="text-[9px] text-purple-200 bg-purple-500/20 px-1.5 py-0.5 rounded">
                    {input.label}
                  </span>
                ))}
                {idea.workflowInputs.length > 4 && (
                  <span className="text-[9px] text-zinc-400">+{idea.workflowInputs.length - 4}</span>
                )}
              </div>
            )}
            {!idea.isBP && !idea.isWorkflow && idea.prompt && (
              <p className="text-[10px] text-zinc-300 line-clamp-3 leading-relaxed">
                {idea.prompt.slice(0, 100)}{idea.prompt.length > 100 ? '...' : ''}
              </p>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        {!isMultiSelectMode && (
          <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {onToggleFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(idea.id);
                }}
                className="p-1 rounded-full backdrop-blur-sm transition-all duration-200"
                style={{
                  background: idea.isFavorite ? 'rgba(234,179,8,0.8)' : isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)',
                  color: idea.isFavorite ? '#fff' : isLight ? '#64748b' : '#fff',
                  boxShadow: isLight ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                  cursor: 'pointer',
                }}
                title="收藏"
              >
                <Star className={`w-3 h-3 ${idea.isFavorite ? 'fill-current' : ''}`} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(idea);
              }}
              className="p-1 rounded-full backdrop-blur-sm transition-all duration-200 hover:bg-blue-500 hover:text-white"
              style={{
                background: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)',
                color: isLight ? '#64748b' : '#fff',
                boxShadow: isLight ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                cursor: 'pointer',
              }}
              title="编辑"
            >
              <EditIcon className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExportSingle(idea);
              }}
              className="p-1 rounded-full backdrop-blur-sm transition-all duration-200 hover:bg-green-500 hover:text-white"
              style={{
                background: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)',
                color: isLight ? '#64748b' : '#fff',
                boxShadow: isLight ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                cursor: 'pointer',
              }}
              title="导出"
            >
              <DownloadIcon className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`确认删除 "${idea.title}"?`)) {
                  onDelete(idea.id);
                }
              }}
              className="p-1 rounded-full backdrop-blur-sm transition-all duration-200 hover:bg-red-500 hover:text-white"
              style={{
                background: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)',
                color: isLight ? '#64748b' : '#fff',
                boxShadow: isLight ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                cursor: 'pointer',
              }}
              title="删除"
            >
              <TrashIcon className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* 左上角标签 */}
        <div className={`absolute top-1.5 ${isMultiSelectMode ? 'left-8' : 'left-1.5'} flex flex-col gap-0.5`}>
          <div className="flex gap-0.5 flex-wrap">
            {idea.isBP && (
              <div
                className="px-1.5 py-0.5 text-[9px] font-bold rounded-full backdrop-blur-sm pointer-events-none shadow-lg"
                style={{ backgroundColor: '#eed16d', color: '#1a1a2e', boxShadow: '0 4px 6px -1px rgba(238,209,109,0.3)' }}
              >
                智能
              </div>
            )}
            {idea.isWorkflow && (
              <div
                className="px-1.5 py-0.5 text-[9px] font-bold rounded-full backdrop-blur-sm pointer-events-none shadow-lg"
                style={{ backgroundColor: '#a855f7', color: '#fff', boxShadow: '0 4px 6px -1px rgba(168,85,247,0.3)' }}
              >
                📊 画布流程
              </div>
            )}
            {idea.author && (
              <div
                className="px-1.5 py-0.5 text-[9px] font-medium rounded-full backdrop-blur-sm pointer-events-none"
                style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}
              >
                @{idea.author}
              </div>
            )}
          </div>
          {idea.isWorkflow && idea.workflowNodes && (
            <div className="px-1.5 py-0.5 bg-purple-500/80 text-white text-[8px] font-bold rounded-full backdrop-blur-sm pointer-events-none">
              {idea.workflowNodes.length} 节点
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

CreativeCard.displayName = 'CreativeCard';

// 虚拟化网格组件
const VirtualizedCreativeGrid: React.FC<VirtualizedCreativeGridProps> = ({
  ideas,
  selectedIds,
  isMultiSelectMode,
  sortBy,
  isLight,
  theme,
  searchTerm,
  filter,
  categoryFilter,
  onToggleSelect,
  onUse,
  onEdit,
  onDelete,
  onToggleFavorite,
  onExportSingle,
  dragItem,
  dragOverItem,
  onDragSort,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // 监听容器宽度变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  const { columnCount, cardSize } = useMemo(
    () => calculateGridDimensions(containerWidth),
    [containerWidth]
  );

  const rowCount = Math.ceil(ideas.length / columnCount);

  // 使用 @tanstack/react-virtual
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => cardSize + CARD_GAP,
    overscan: 3,
  });

  if (ideas.length === 0) {
    return (
      <main ref={containerRef} className="flex-grow overflow-y-auto py-2 px-3">
        <div className="text-center flex flex-col items-center justify-center h-full">
          <LibraryIcon className="w-12 h-12 mb-3" style={{ color: theme.colors.textMuted }} />
          <h2 className="text-lg font-semibold" style={{ color: theme.colors.textSecondary }}>
            {searchTerm || filter !== 'all' || categoryFilter !== 'all' ? '未找到创意' : '创意文本库是空的'}
          </h2>
          <p className="mt-1 text-sm" style={{ color: theme.colors.textMuted }}>
            {searchTerm || filter !== 'all' || categoryFilter !== 'all'
              ? '请尝试其他关键词或筛选条件'
              : '点击 "新增" 来添加您的第一个灵感！'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      ref={containerRef}
      className="flex-grow overflow-auto min-h-0"
      style={{ padding: GRID_PADDING }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
              display: 'flex',
              gap: CARD_GAP,
            }}
          >
            {Array.from({ length: columnCount }).map((_, colIndex) => {
              const index = virtualRow.index * columnCount + colIndex;
              if (index >= ideas.length) return null;

              const idea = ideas[index];
              const isSelected = selectedIds.has(idea.id);

              return (
                <CreativeCard
                  key={idea.id}
                  idea={idea}
                  isSelected={isSelected}
                  isMultiSelectMode={isMultiSelectMode}
                  sortBy={sortBy}
                  isLight={isLight}
                  theme={theme}
                  style={{ width: cardSize, height: cardSize }}
                  onToggleSelect={onToggleSelect}
                  onUse={onUse}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleFavorite={onToggleFavorite}
                  onExportSingle={onExportSingle}
                  dragItem={dragItem}
                  dragOverItem={dragOverItem}
                  onDragSort={onDragSort}
                />
              );
            })}
          </div>
        ))}
      </div>
    </main>
  );
};


interface CreativeLibraryProps {
  ideas: CreativeIdea[];
  onBack: () => void;
  onAdd: () => void;
  onDelete: (id: number) => void;
  onDeleteMultiple?: (ids: number[]) => void; // 新增：批量删除
  onEdit: (idea: CreativeIdea) => void;
  onUse: (idea: CreativeIdea) => void;
  onExport: () => void;
  onImport: () => void;
  onImportById: (idRange: string) => Promise<void>;
  onReorder: (reorderedIdeas: CreativeIdea[]) => void;
  onToggleFavorite?: (id: number) => void;
  onUpdateCategory?: (id: number, category: CreativeCategoryType) => Promise<void>; // 新增：更新分类
  isImporting?: boolean; // 导入状态
  isImportingById?: boolean; // 按ID导入状态
}

type FilterType = 'all' | 'bp' | 'workflow' | 'favorite';
type SortType = 'time' | 'title' | 'manual';
type CategoryFilterType = 'all' | CreativeCategoryType;

export const CreativeLibrary: React.FC<CreativeLibraryProps> = ({ ideas, onBack, onAdd, onDelete, onDeleteMultiple, onEdit, onUse, onExport, onImport, onImportById, onReorder, onToggleFavorite, onUpdateCategory, isImporting, isImportingById }) => {
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const { themeName, theme } = useTheme();
  const isLight = themeName === 'light';
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('time'); // 默认按时间排序
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // AI 自动分类状态
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);
  const [classifyProgress, setClassifyProgress] = useState({ current: 0, total: 0 });
  
  // 多选状态
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const dragItem = useRef<CreativeIdea | null>(null);
  const dragOverItem = useRef<CreativeIdea | null>(null);

  // 单个创意导出功能
  const handleExportSingle = async (idea: CreativeIdea) => {
    try {
      // 转换图片为base64
      const convertImageToBase64 = async (url: string): Promise<string> => {
        if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
          return url;
        }
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn('图片转换失败:', url, e);
          return url;
        }
      };

      const ideaWithBase64 = {
        ...idea,
        imageUrl: await convertImageToBase64(idea.imageUrl)
      };

      const dataStr = JSON.stringify(ideaWithBase64, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      // 文件名用创意标题
      const safeTitle = idea.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
      link.download = `creative_${safeTitle}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('导出失败:', e);
      alert('导出失败');
    }
  };

  // 多选操作方法
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredIdeas.map(idea => idea.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const toggleMultiSelectMode = () => {
    setIsMultiSelectMode(!isMultiSelectMode);
    if (isMultiSelectMode) {
      setSelectedIds(new Set()); // 退出多选模式时清空选中
    }
  };

  // 批量导出
  const handleExportSelected = async () => {
    if (selectedIds.size === 0) {
      alert('请先选择要导出的创意');
      return;
    }

    try {
      const convertImageToBase64 = async (url: string): Promise<string> => {
        if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
          return url;
        }
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn('图片转换失败:', url, e);
          return url;
        }
      };

      const selectedIdeas = ideas.filter(idea => selectedIds.has(idea.id));
      const ideasWithBase64 = await Promise.all(
        selectedIdeas.map(async (idea) => ({
          ...idea,
          imageUrl: await convertImageToBase64(idea.imageUrl)
        }))
      );

      const dataStr = JSON.stringify(ideasWithBase64, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `creative_export_${selectedIds.size}条_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      alert(`成功导出 ${selectedIds.size} 个创意`);
    } catch (e) {
      console.error('批量导出失败:', e);
      alert('导出失败');
    }
  };

  // 批量删除
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      alert('请先选择要删除的创意');
      return;
    }

    if (window.confirm(`确认删除选中的 ${selectedIds.size} 个创意？`)) {
      if (onDeleteMultiple) {
        onDeleteMultiple(Array.from(selectedIds));
      } else {
        // 如果没有批量删除方法，逐个删除
        selectedIds.forEach(id => onDelete(id));
      }
      setSelectedIds(new Set());
      setIsMultiSelectMode(false);
    }
  };

  // AI 自动分类未分类的创意
  const handleAutoClassify = async () => {
    if (!onUpdateCategory) {
      alert('分类更新功能未配置');
      return;
    }
    
    // 筛选未分类的创意
    const uncategorized = ideas.filter(idea => !idea.category);
    
    if (uncategorized.length === 0) {
      alert('所有创意已分类，无需操作');
      return;
    }
    
    if (!window.confirm(`发现 ${uncategorized.length} 个未分类的创意，是否用 AI 自动分类？`)) {
      return;
    }
    
    setIsAutoClassifying(true);
    setClassifyProgress({ current: 0, total: uncategorized.length });
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < uncategorized.length; i++) {
      const idea = uncategorized[i];
      setClassifyProgress({ current: i + 1, total: uncategorized.length });
      
      try {
        const category = await autoClassifyCreative(idea.title, idea.prompt);
        await onUpdateCategory(idea.id, category);
        successCount++;
      } catch (e) {
        console.error(`分类失败 [${idea.title}]:`, e);
        failCount++;
      }
      
      // 防止请求过快
      if (i < uncategorized.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    
    setIsAutoClassifying(false);
    setClassifyProgress({ current: 0, total: 0 });
    
    alert(`分类完成！成功: ${successCount}，失败: ${failCount}`);
  };

  const filteredIdeas = useMemo(() => {
    let result = ideas
      .filter(idea => {
        // 类型筛选
        if (filter === 'bp' && !idea.isBP) return false;
        if (filter === 'workflow' && !idea.isWorkflow) return false;
        if (filter === 'favorite' && !idea.isFavorite) return false;
        return true;
      })
      .filter(idea => {
        // 分类筛选
        if (categoryFilter === 'all') return true;
        return idea.category === categoryFilter;
      })
      .filter(idea =>
        idea.title.toLowerCase().includes(searchTerm.toLowerCase())
      );
    
    // 排序
    if (sortBy === 'time') {
      // 按添加时间排序（新的在前）
      result = [...result].sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      });
    } else if (sortBy === 'title') {
      // 按标题字母排序
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    }
    // manual 保持原有顺序
    
    return result;
  }, [ideas, searchTerm, filter, categoryFilter, sortBy]);

  // 统计各分类数量
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: ideas.length };
    CREATIVE_CATEGORIES.forEach(cat => {
      counts[cat.key] = ideas.filter(idea => idea.category === cat.key).length;
    });
    // 未分类的数量
    counts['uncategorized'] = ideas.filter(idea => !idea.category).length;
    return counts;
  }, [ideas]);

  const handleDragSort = () => {
    if (!dragItem.current || !dragOverItem.current || dragItem.current.id === dragOverItem.current.id) {
      return;
    }

    const newIdeas = [...ideas];
    const dragItemIndex = ideas.findIndex(i => i.id === dragItem.current!.id);
    const dragOverItemIndex = ideas.findIndex(i => i.id === dragOverItem.current!.id);

    if (dragItemIndex === -1 || dragOverItemIndex === -1) return;

    const [draggedItem] = newIdeas.splice(dragItemIndex, 1);
    newIdeas.splice(dragOverItemIndex, 0, draggedItem);
    
    dragItem.current = null;
    dragOverItem.current = null;
    
    onReorder(newIdeas);
  };

  const filterButtons: { key: FilterType, label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'favorite', label: '⭐ 收藏' },
    { key: 'bp', label: '智能变量' },
    { key: 'workflow', label: '📊 画布流程' },
  ];

  return (
    <div 
      className="flex flex-col w-full h-full p-4 animate-fade-in transition-colors duration-300"
      style={{ background: theme.colors.bgPrimary }}
    >
      <header 
        className="flex-shrink-0 flex items-center justify-between gap-3 pb-3"
        style={{ borderBottom: `1px solid ${theme.colors.border}` }}
      >
        <div>
          <h1 className="text-xl font-bold" style={{ color: theme.colors.primary }}>
            创意文本库
          </h1>
          <p className="text-xs mt-0.5" style={{ color: theme.colors.textMuted }}>管理和使用您的创意灵感</p>
        </div>
        <div className="flex items-center gap-2">
                    <button
            onClick={onImport}
            disabled={isImporting}
            className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-xs transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${theme.colors.border}`,
              color: theme.colors.textPrimary
            }}
          >
            {isImporting ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                <span>导入中...</span>
              </>
            ) : (
              <>
                <UploadIcon className="w-4 h-4" />
                <span>导入</span>
              </>
            )}
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            disabled={isImportingById}
            className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-xs transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${theme.colors.border}`,
              color: theme.colors.textPrimary
            }}
          >
            {isImportingById ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                <span>导入中...</span>
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4" />
                <span>智能导入</span>
              </>
            )}
          </button>
           <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-xs transition-all duration-200"
            style={{
              backgroundColor: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${theme.colors.border}`,
              color: theme.colors.textPrimary
            }}
          >
            <DownloadIcon className="w-4 h-4" />
            <span>导出</span>
          </button>
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white font-semibold rounded-lg text-xs shadow-lg shadow-blue-500/25 hover:bg-blue-400 transition-all duration-200"
          >
            <PlusCircleIcon className="w-4 h-4" />
            <span>新增</span>
          </button>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-xs transition-all duration-200"
            style={{
              backgroundColor: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${theme.colors.border}`,
              color: theme.colors.textPrimary
            }}
          >
            &larr; 返回
          </button>
        </div>
      </header>

      <div className="flex-shrink-0 flex items-center justify-between gap-3 py-3">
        <div className="relative flex-grow">
          <SearchIconLucide className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: theme.colors.textMuted }} />
          <input
            type="text"
            placeholder="搜索标题..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full rounded-lg py-2 pl-8 pr-3 text-xs transition-all duration-200"
            style={{ 
              background: theme.colors.bgSecondary,
              border: `1px solid ${theme.colors.border}`,
              color: theme.colors.textPrimary
            }}
          />
        </div>
        
        {/* 排序选择器 */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortType)}
          className="px-2 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200"
          style={{ 
            background: theme.colors.bgSecondary,
            border: `1px solid ${theme.colors.border}`,
            color: theme.colors.textPrimary
          }}
        >
          <option value="time">按时间</option>
          <option value="title">按标题</option>
          <option value="manual">手动排序</option>
        </select>
        
        {/* 多选模式按钮 */}
        <button
          onClick={toggleMultiSelectMode}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-xs transition-all duration-200 ${
            isMultiSelectMode ? 'bg-purple-500 text-white' : ''
          }`}
          style={{
            backgroundColor: isMultiSelectMode ? undefined : (isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)'),
            border: `1px solid ${isMultiSelectMode ? 'transparent' : theme.colors.border}`,
            color: isMultiSelectMode ? undefined : theme.colors.textPrimary
          }}
        >
          <Clipboard className="w-4 h-4" />
          <span>{isMultiSelectMode ? '取消多选' : '多选'}</span>
        </button>
        
        <div 
          className="flex items-center gap-0.5 p-0.5 rounded-lg"
          style={{ 
            background: theme.colors.bgSecondary,
            border: `1px solid ${theme.colors.border}`
          }}
        >
          {filterButtons.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all duration-200 ${
                filter === key
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                  : ''
              }`}
              style={{
                color: filter === key ? undefined : theme.colors.textMuted
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      
      {/* 多选操作栏 */}
      {isMultiSelectMode && (
        <div 
          className="flex-shrink-0 flex items-center justify-between gap-3 py-2 px-3 mb-2 rounded-lg"
          style={{ 
            background: isLight ? 'rgba(147,51,234,0.1)' : 'rgba(147,51,234,0.2)',
            border: `1px solid rgba(147,51,234,0.3)`
          }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium" style={{ color: theme.colors.textPrimary }}>
              已选中 {selectedIds.size} / {filteredIdeas.length} 项
            </span>
            <button
              onClick={selectAll}
              className="text-xs font-semibold text-purple-500 hover:text-purple-400 transition-colors"
            >
              全选
            </button>
            <button
              onClick={deselectAll}
              className="text-xs font-semibold text-purple-500 hover:text-purple-400 transition-colors"
            >
              取消全选
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportSelected}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white font-semibold rounded-lg text-xs transition-all duration-200 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <DownloadIcon className="w-4 h-4" />
              <span>导出选中</span>
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white font-semibold rounded-lg text-xs transition-all duration-200 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <TrashIcon className="w-4 h-4" />
              <span>删除选中</span>
            </button>
          </div>
        </div>
      )}
      
      {/* 主内容区域 - 左侧分类 + 右侧卡片 */}
      <div className="flex-grow flex min-h-0 overflow-hidden">
        {/* 左侧分类侧边栏 */}
        <aside 
          className={`flex-shrink-0 border-r overflow-y-auto transition-all duration-300 ${sidebarCollapsed ? 'w-12' : 'w-40'}`}
          style={{ borderColor: theme.colors.border }}
        >
          {/* 侧边栏头部 */}
          <div 
            className="sticky top-0 flex items-center justify-between px-3 py-2 border-b"
            style={{ background: theme.colors.bgPrimary, borderColor: theme.colors.border }}
          >
            {!sidebarCollapsed && (
              <span className="text-xs font-medium" style={{ color: theme.colors.textMuted }}>分类</span>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              style={{ color: theme.colors.textMuted }}
              title={sidebarCollapsed ? '展开分类' : '收起分类'}
            >
              <Layers className="w-4 h-4" />
            </button>
          </div>
          
          {/* 分类列表 */}
          <div className="py-1">
            {/* 全部 */}
            <button
              onClick={() => setCategoryFilter('all')}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-all ${
                categoryFilter === 'all' ? 'font-semibold' : ''
              }`}
              style={{ 
                background: categoryFilter === 'all' 
                  ? (isLight ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)') 
                  : 'transparent',
                color: categoryFilter === 'all' ? '#3b82f6' : theme.colors.textSecondary
              }}
            >
              <FolderOpen className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span className="flex-grow text-left">全部</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ 
                    background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' 
                  }}>
                    {categoryCounts.all}
                  </span>
                </>
              )}
            </button>
            
            {/* 分类列表 */}
            {CREATIVE_CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => setCategoryFilter(cat.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-all ${
                  categoryFilter === cat.key ? 'font-semibold' : ''
                }`}
                style={{ 
                  background: categoryFilter === cat.key 
                    ? (isLight ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)') 
                    : 'transparent',
                  color: categoryFilter === cat.key ? '#3b82f6' : theme.colors.textSecondary
                }}
                title={sidebarCollapsed ? `${cat.icon} ${cat.label} (${categoryCounts[cat.key] || 0})` : undefined}
              >
                <span className="text-sm flex-shrink-0">{cat.icon}</span>
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-grow text-left">{cat.label}</span>
                    {(categoryCounts[cat.key] || 0) > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ 
                        background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' 
                      }}>
                        {categoryCounts[cat.key]}
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
            
            {/* 未分类 */}
            {categoryCounts['uncategorized'] > 0 && (
              <button
                onClick={() => setCategoryFilter('other')}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-all opacity-60 hover:opacity-100`}
                style={{ color: theme.colors.textMuted }}
              >
                <span className="text-sm flex-shrink-0">❓</span>
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-grow text-left">未分类</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ 
                      background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' 
                    }}>
                      {categoryCounts['uncategorized']}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
          
          {/* AI 自动分类按钮 */}
          {categoryCounts['uncategorized'] > 0 && onUpdateCategory && (
            <div className="px-2 py-2 border-t" style={{ borderColor: theme.colors.border }}>
              <button
                onClick={handleAutoClassify}
                disabled={isAutoClassifying}
                className={`w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                  sidebarCollapsed ? 'px-1' : ''
                }`}
                style={{
                  background: isAutoClassifying 
                    ? (isLight ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.25)')
                    : (isLight ? 'rgba(168,85,247,0.1)' : 'rgba(168,85,247,0.15)'),
                  color: '#a855f7',
                  border: '1px solid rgba(168,85,247,0.3)'
                }}
                title={sidebarCollapsed ? `AI 自动分类 (${categoryCounts['uncategorized']} 个未分类)` : undefined}
              >
                {isAutoClassifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {!sidebarCollapsed && (
                      <span>{classifyProgress.current}/{classifyProgress.total}</span>
                    )}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {!sidebarCollapsed && <span>AI 分类</span>}
                  </>
                )}
              </button>
            </div>
          )}
        </aside>
        
        {/* 右侧卡片区域 */}
        <VirtualizedCreativeGrid
          ideas={filteredIdeas}
          selectedIds={selectedIds}
          isMultiSelectMode={isMultiSelectMode}
          sortBy={sortBy}
          isLight={isLight}
          theme={theme}
          searchTerm={searchTerm}
          filter={filter}
          categoryFilter={categoryFilter}
          onToggleSelect={toggleSelect}
          onUse={onUse}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleFavorite={onToggleFavorite}
          onExportSingle={handleExportSingle}
          dragItem={dragItem}
          dragOverItem={dragOverItem}
          onDragSort={handleDragSort}
        />
      </div>
      
      <ImportCreativeModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={onImportById}
        isImporting={isImportingById}
      />
    </div>
  );
};

