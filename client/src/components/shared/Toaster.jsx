// In-app toast popups, anchored bottom-right. Driven by NotificationContext:
// every new notification (incl. direct messages) slides in here, dings via the
// existing notification sound, then auto-dismisses. Also surfaces a one-time
// "enable desktop alerts" card so users can turn on OS push (app-closed alerts).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Bell, MessageSquare, CheckCircle2, AlertTriangle, BellRing } from 'lucide-react';

const TYPE_STYLE = {
  MESSAGE_RECEIVED: { icon: MessageSquare, ring: 'ring-blue-200', chip: 'bg-blue-100 text-blue-700' },
  MESSAGE_DONE: { icon: CheckCircle2, ring: 'ring-green-200', chip: 'bg-green-100 text-green-700' },
  LOW_STOCK: { icon: AlertTriangle, ring: 'ring-red-200', chip: 'bg-red-100 text-red-700' },
  BROADCAST: { icon: BellRing, ring: 'ring-purple-200', chip: 'bg-purple-100 text-purple-700' },
};
const DEFAULT_STYLE = { icon: Bell, ring: 'ring-navy-200', chip: 'bg-navy-100 text-navy-700' };

const AUTO_DISMISS_MS = 7000;

function ToastCard({ toast, onDismiss }) {
  const navigate = useNavigate();
  const [shown, setShown] = useState(false);
  const style = TYPE_STYLE[toast.type] || DEFAULT_STYLE;
  const Icon = style.icon;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const timer = setTimeout(() => onDismiss(toast.uid), AUTO_DISMISS_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [toast.uid, onDismiss]);

  const open = () => {
    onDismiss(toast.uid);
    navigate(toast.url || '/notifications');
  };

  return (
    <div
      role="status"
      className={`pointer-events-auto w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-white shadow-2xl ring-1 ${style.ring} border border-gray-100 transition-all duration-300 ${shown ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}
    >
      <div className="flex items-start gap-3 p-3">
        <button onClick={open} className="flex items-start gap-3 flex-1 text-left min-w-0">
          <span className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${style.chip}`}>
            <Icon size={16} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-900 truncate">{toast.title || 'Notification'}</span>
            {toast.message && <span className="block text-xs text-gray-600 mt-0.5 line-clamp-2">{toast.message}</span>}
          </span>
        </button>
        <button onClick={() => onDismiss(toast.uid)} className="text-gray-400 hover:text-gray-700 flex-shrink-0" aria-label="Dismiss">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function EnableCard({ onEnable, onDismiss }) {
  return (
    <div className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-navy-800 text-white shadow-2xl ring-1 ring-white/10 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
          <BellRing size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Turn on desktop alerts</p>
          <p className="text-xs text-blue-100/80 mt-0.5">Get notifications on your desktop even when this tab is closed.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={onEnable} className="px-3 py-1 text-xs font-medium bg-white text-navy-800 rounded hover:bg-blue-50">Enable</button>
            <button onClick={onDismiss} className="px-3 py-1 text-xs text-blue-100/80 hover:text-white">Not now</button>
          </div>
        </div>
        <button onClick={onDismiss} className="text-blue-200/70 hover:text-white flex-shrink-0" aria-label="Dismiss">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

export default function Toaster({ toasts = [], onDismiss, showEnable = false, onEnable, onDismissEnable }) {
  if (toasts.length === 0 && !showEnable) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 pointer-events-none">
      {toasts.map((t) => <ToastCard key={t.uid} toast={t} onDismiss={onDismiss} />)}
      {showEnable && <EnableCard onEnable={onEnable} onDismiss={onDismissEnable} />}
    </div>
  );
}
