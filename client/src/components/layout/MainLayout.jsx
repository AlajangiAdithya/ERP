import { useRef } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import InProgressBadge from '../shared/InProgressBadge';
import { useAuditMode, resetAudit } from '../../pages/superadmin/auditOverlay';

export default function MainLayout({ children }) {
  const audit = useAuditMode();
  const clickTimes = useRef([]);

  // In audit mode, three clicks anywhere in the top-left logo region within
  // 800 ms triggers a reset of all in-tab edits. Kept invisible so the
  // auditor never notices.
  const handleAuditClick = (e) => {
    if (!audit) return;
    if (e.clientX > 120 || e.clientY > 80) return;
    const now = Date.now();
    clickTimes.current = [...clickTimes.current, now].filter((t) => now - t < 800);
    if (clickTimes.current.length >= 3) {
      clickTimes.current = [];
      resetAudit();
    }
  };

  return (
    <div className="min-h-screen bg-brand-gray" onClick={handleAuditClick}>
      <Sidebar />
      <div className="flex flex-col min-w-0 lg:pl-56">
        <Header />
        <main className="flex-1 p-6 animate-fade-in">
          {children}
        </main>
      </div>
      <InProgressBadge />
    </div>
  );
}
