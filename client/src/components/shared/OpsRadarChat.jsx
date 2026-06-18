import PdcStatusBoard from './PdcStatusBoard';
import TeamChat from './TeamChat';

// Dashboard "operations row" — the PDC delivery radar and the org Team Chat
// shown side by side, since both are day-to-day priorities. On wide screens the
// radar takes two-thirds and the chat one-third; they stack on smaller screens.
// The radar always renders (showAllClear) so the two columns stay balanced.
export default function OpsRadarChat() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      <div className="xl:col-span-2 min-w-0 space-y-3">
        <PdcStatusBoard showAllClear />
      </div>
      <div className="xl:col-span-1 min-w-0">
        <TeamChat heightClass="h-[26rem]" />
      </div>
    </div>
  );
}
