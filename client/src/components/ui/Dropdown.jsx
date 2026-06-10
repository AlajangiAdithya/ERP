import { useState, useRef, useEffect } from 'react';

export default function Dropdown({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className={`absolute z-40 mt-2 w-52 bg-white rounded-xl shadow-pop ring-1 ring-navy-100 py-1.5 px-1.5 animate-scale-in
          ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 text-left text-sm rounded-lg transition-colors
        ${danger ? 'text-brand-red hover:bg-red-50' : 'text-navy-700 hover:bg-navy-50'}`}
    >
      {children}
    </button>
  );
}
