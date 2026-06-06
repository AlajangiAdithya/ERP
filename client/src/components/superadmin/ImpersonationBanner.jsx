// Floating banner that appears only when the owner has impersonated another
// user. One tap restores the owner's session. Hidden for all other states —
// no visual trace for regular users.
import { useNavigate } from 'react-router-dom';
import { Eye, ArrowLeftCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function ImpersonationBanner() {
  const { isImpersonating, returnToOwner, user } = useAuth();
  const navigate = useNavigate();
  if (!isImpersonating) return null;

  const handleReturn = () => {
    if (returnToOwner()) navigate('/superadmin');
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 px-3 py-2 rounded-full bg-purple-700 text-white text-xs shadow-lg ring-1 ring-purple-300/40 backdrop-blur">
      <Eye size={14} className="opacity-90" />
      <span className="hidden sm:inline">Viewing as <strong className="font-semibold">{user?.name || user?.username}</strong></span>
      <span className="sm:hidden font-semibold">{user?.username}</span>
      <button
        onClick={handleReturn}
        className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white text-purple-800 font-semibold hover:bg-purple-50"
      >
        <ArrowLeftCircle size={13} /> Return
      </button>
    </div>
  );
}
