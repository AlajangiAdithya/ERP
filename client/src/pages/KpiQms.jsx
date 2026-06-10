import { Gauge } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import KpiQmsSection from '../components/shared/KpiQmsSection';

// KPI — QMS page. Visible to every authenticated role, view-only: every figure
// is auto-computed server-side from Work Orders, QC inspections and POs.
// Certifications are the only writable piece — Unit-5 uploads (gated server-side).
export default function KpiQms() {
  return (
    <div className="space-y-5">
      <PageHero
        title="KPIs"
        eyebrow="QMS — Key Performance Indicators"
        subtitle="On-time deliveries, tender vs order conversion, supplier performance rating, QC product rejections and company certifications — auto-generated from system records. Certifications maintained by Unit-5; everyone views."
        icon={Gauge}
      />
      <KpiQmsSection />
    </div>
  );
}
