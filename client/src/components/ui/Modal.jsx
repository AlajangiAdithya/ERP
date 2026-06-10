import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-navy-900/55 backdrop-blur-[3px]" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-pop ring-1 ring-navy-100 w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col animate-scale-in overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-100 bg-gradient-to-b from-navy-50/60 to-white">
          <h2 className="text-lg font-bold text-navy-800 tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-400 hover:text-navy-700 hover:bg-navy-100/70 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
