import Sidebar from './Sidebar';
import Header from './Header';
import InProgressBadge from '../shared/InProgressBadge';

export default function MainLayout({ children }) {
  return (
    <div className="min-h-screen bg-brand-gray">
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
