import { MessagesSquare, Megaphone, AtSign, CornerUpLeft, CheckCircle2, History } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import TeamChat from '../components/shared/TeamChat';

// Org-wide messaging hub. Wraps the TeamChat component (broadcast via
// @everyone + direct @username messages). Open to every signed-in user;
// Planning is the primary broadcaster pushing notices to the whole plant.

const HOW_IT_WORKS = [
  {
    icon: Megaphone,
    tone: 'from-purple-500 to-fuchsia-600',
    chip: 'bg-purple-100 text-purple-700 ring-purple-200',
    title: 'Broadcast to everyone',
    body: (
      <>
        Start with <code className="font-mono text-purple-700 bg-purple-50 px-1 rounded">@everyone</code> then your
        message. It reaches every signed-in user across the plant.
      </>
    ),
  },
  {
    icon: AtSign,
    tone: 'from-blue-500 to-navy-700',
    chip: 'bg-blue-100 text-blue-700 ring-blue-200',
    title: 'Message one person',
    body: (
      <>
        Type <code className="font-mono text-blue-700 bg-blue-50 px-1 rounded">@username</code> and pick from the list,
        then write your note. Only they see it — and they get a notification.
      </>
    ),
  },
  {
    icon: CheckCircle2,
    tone: 'from-emerald-500 to-teal-600',
    chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    title: 'Close the loop',
    body: 'The receiver marks a request "Done"; the sender can then clear it. Everything stays in History.',
  },
];

export default function Messaging() {
  return (
    <div className="space-y-6">
      <PageHero
        title="Messaging"
        subtitle="Broadcast to the whole plant with @everyone, or send a direct note with @username. Replies, work hand-offs, and history all live here."
        eyebrow="Team Chat"
        icon={MessagesSquare}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Chat — the main column */}
        <div className="lg:col-span-2">
          <TeamChat heightClass="h-[58vh] min-h-[26rem]" />
        </div>

        {/* Helper rail — keeps it obvious for non-technical users */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="rounded-2xl bg-white border border-navy-100/60 shadow-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-navy-50/70 to-transparent">
              <h3 className="text-sm font-semibold text-navy-800">How it works</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Three ways to keep everyone in sync.</p>
            </div>
            <ul className="p-4 space-y-3">
              {HOW_IT_WORKS.map(({ icon: Icon, tone, title, body }) => (
                <li key={title} className="flex gap-3">
                  <span className={`flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br ${tone} text-white flex items-center justify-center shadow-sm`}>
                    <Icon size={16} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-800 leading-tight">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl bg-navy-50/60 border border-navy-100/70 p-4">
            <div className="flex items-center gap-2 text-navy-700">
              <CornerUpLeft size={14} />
              <span className="text-xs font-semibold uppercase tracking-wide">Quick tips</span>
            </div>
            <ul className="mt-2.5 space-y-1.5 text-xs text-navy-700/90 leading-relaxed">
              <li>• Hover a message and hit <span className="font-medium">Reply</span> to answer fast.</li>
              <li>• <span className="font-medium">Enter</span> sends, <span className="font-medium">Shift+Enter</span> adds a line.</li>
              <li className="flex items-center gap-1.5">
                <History size={12} className="text-navy-500" />
                Cleared messages stay in <span className="font-medium">History</span>.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
