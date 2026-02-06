
import React, { useEffect, useRef } from 'react';
import { Icons } from './Icons';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  options: { label: string; icon?: React.ReactNode; action: () => void; danger?: boolean }[];
  isLight?: boolean;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, options, isLight = false }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div 
      ref={menuRef}
      className={`fixed z-[100] w-48 border rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-left ${
        isLight
          ? 'bg-white border-gray-200 shadow-gray-300/50'
          : 'bg-[#1c1c1e] border-white/10'
      }`}
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-1 flex flex-col gap-0.5">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={(e) => { 
                e.stopPropagation(); 
                opt.action(); 
                onClose(); 
            }}
            className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center gap-2 transition-colors
              ${opt.danger 
                ? isLight
                  ? 'text-red-500 hover:bg-red-50'
                  : 'text-red-400 hover:bg-red-500/10'
                : isLight
                  ? 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  : 'text-zinc-300 hover:bg-white/10 hover:text-white'
              }
            `}
          >
            {opt.icon && React.cloneElement(opt.icon as React.ReactElement<any>, { size: 14 })}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ContextMenu;
