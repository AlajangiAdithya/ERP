import Sidebar from './Sidebar';
import Header from './Header';
import InProgressBadge from '../shared/InProgressBadge';

export default function MainLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-brand-gray relative overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-blue-50/50 to-transparent pointer-events-none -z-10" />
      
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 z-0">
        <Header />
        <main className="flex-1 p-6 lg:p-8 animate-fade-in">
          {children}
        </main>
      </div>
      <InProgressBadge />
    </div>
  );
}
