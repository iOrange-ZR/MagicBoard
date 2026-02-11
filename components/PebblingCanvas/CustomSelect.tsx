/**
 * CustomSelect - 自定义下拉选择器
 * 替代原生 select，支持深色/浅色主题
 */

import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface CustomSelectProps {
    options: string[];
    value: string;
    onChange: (value: string) => void;
    isLightCanvas: boolean;
    themeColors: { textSecondary: string };
}

const CustomSelect: React.FC<CustomSelectProps> = ({ options, value, onChange, isLightCanvas, themeColors }) => {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    return (
        <div ref={ref} className="relative w-full">
            <div
                className="w-full rounded px-1.5 py-0.5 text-[8px] cursor-pointer flex items-center justify-between"
                style={{ backgroundColor: isLightCanvas ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)', color: themeColors.textSecondary }}
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <span className="truncate">{value}</span>
                <ChevronDown size={10} className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
            {isOpen && (
                <div
                    className="absolute top-full left-0 right-0 mt-0.5 rounded shadow-lg z-50 max-h-40 overflow-y-auto"
                    style={{ backgroundColor: isLightCanvas ? '#ffffff' : '#1c1c1e', border: `1px solid ${isLightCanvas ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}` }}
                >
                    {options.map((opt, i) => (
                        <div
                            key={i}
                            className={`px-2 py-1 text-[8px] cursor-pointer transition-colors ${opt === value ? 'font-bold' : ''}`}
                            style={{
                                backgroundColor: opt === value ? (isLightCanvas ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.2)') : 'transparent',
                                color: opt === value ? '#10b981' : themeColors.textSecondary
                            }}
                            onClick={(e) => { e.stopPropagation(); onChange(opt); setIsOpen(false); }}
                            onMouseEnter={(e) => { (e.target as HTMLDivElement).style.backgroundColor = isLightCanvas ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'; }}
                            onMouseLeave={(e) => { (e.target as HTMLDivElement).style.backgroundColor = opt === value ? (isLightCanvas ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.2)') : 'transparent'; }}
                        >
                            {opt}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CustomSelect;
