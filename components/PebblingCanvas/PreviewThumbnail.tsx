/**
 * PreviewThumbnail - 预览节点缩略图
 * 进入视口后再加载，避免多图/多视频同时加载导致卡顿
 * 单击选择封面，双击打开原图预览
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import { Icons } from './Icons';

export interface PreviewThumbnailProps {
    url: string;
    isVideo: boolean;
    index: number;
    isSelected: boolean;
    isLightCanvas: boolean;
    onSelect: () => void;
    onPreviewOriginal?: (url: string) => void;
    nodeId: string;
}

const PreviewThumbnail = memo<PreviewThumbnailProps>(({ url, isVideo, isSelected, isLightCanvas, onSelect, onPreviewOriginal, index, nodeId }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [imgError, setImgError] = useState(false);
    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            ([e]) => setVisible(e.isIntersecting),
            { rootMargin: '80px', threshold: 0.01 }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    const content = !visible ? (
        <div className="w-full h-full min-h-[40px] flex items-center justify-center" style={{ backgroundColor: isLightCanvas ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }}>
            <Icons.Image size={16} style={{ color: isLightCanvas ? '#9ca3af' : 'rgba(255,255,255,0.3)' }} />
        </div>
    ) : isVideo ? (
        <video
            src={url}
            className="w-full h-full object-contain"
            muted
            playsInline
            preload="metadata"
            aria-label={`预览 ${index + 1}`}
        />
    ) : imgError ? (
        <div className="w-full h-full min-h-[40px] flex items-center justify-center" style={{ backgroundColor: isLightCanvas ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }}>
            <Icons.Image size={16} style={{ color: isLightCanvas ? '#9ca3af' : 'rgba(255,255,255,0.3)' }} />
        </div>
    ) : (
        <img
            src={url}
            alt=""
            className="w-full h-full object-contain"
            draggable={false}
            loading="lazy"
            onError={() => setImgError(true)}
        />
    );

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
        } else {
            clickTimerRef.current = setTimeout(() => {
                onSelect();
                clickTimerRef.current = null;
            }, 280);
        }
    };
    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
        }
        onPreviewOriginal?.(url);
    };

    return (
        <div
            ref={containerRef}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            className="relative rounded-lg overflow-hidden cursor-pointer flex items-center justify-center bg-black/20"
            style={{
                border: isSelected ? '2px solid #3b82f6' : `1px solid ${isLightCanvas ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
                minHeight: 60,
            }}
            title="单击选择为封面，双击打开原图预览"
        >
            {content}
            <span className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: isLightCanvas ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.5)', color: isLightCanvas ? '#374151' : '#e5e7eb' }}>
                {index + 1}
            </span>
            {isSelected && (
                <div className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500 text-white">
                    <Icons.Check size={10} />
                    引用
                </div>
            )}
        </div>
    );
});
PreviewThumbnail.displayName = 'PreviewThumbnail';

export default PreviewThumbnail;
