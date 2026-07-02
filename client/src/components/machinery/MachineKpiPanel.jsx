import { useState, useEffect, useCallback } from 'react';
import { Gauge, FileDown, Clock, Wrench, Activity } from 'lucide-react';
import api from '../../api/axios';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

// Monthly machine utilisation KPI + auto-generated per-machine report.
// Working window 09:00–19:00; working days = Mon–Sat.

const thisMonth = () => new Date().toISOString().slice(0, 7);
const fmtHrs = (min) => `${(min / 60).toFixed(1)}h`;
const pctTone = (p) => (p >= 70 ? 'text-emerald-700' : p >= 40 ? 'text-amber-700' : 'text-red-600');
const barTone = (p) => (p >= 70 ? 'bg-emerald-500' : p >= 40 ? 'bg-amber-500' : 'bg-red-500');

export default function MachineKpiPanel() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reportFor, setReportFor] = useState(null); // machine row for report modal

  const load = useCallback(async (m) => {
    setLoading(true);
    try {
      const res = await api.get('/machine-allocations/kpi', { params: { month: m } });
      setData(res.data);
    } catch (err) {
      console.error('Load machine KPI error', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div>
          <label className="block text-[13px] font-semibold text-navy-700 mb-1.5">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 bg-white border border-navy-200 rounded-lg text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
          />
        </div>
        {data && (
          <div className="flex-1 flex flex-wrap gap-3 sm:justify-end text-sm">
            <Stat label="Machines" value={data.machineCount} />
            <Stat label="Working days" value={data.workingDays} />
            <Stat label="Overall utilisation" value={`${data.overallUtilizationPercent}%`} tone={pctTone(data.overallUtilizationPercent)} />
          </div>
        )}
      </div>

      <Card className="overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data?.rows?.length ? (
          <div className="text-center py-12 text-sm text-gray-500">No machines on file.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="px-3 py-2">Machine</th>
                <th className="px-3 py-2">Utilisation</th>
                <th className="px-3 py-2 text-right">Busy</th>
                <th className="px-3 py-2 text-right">Idle</th>
                <th className="px-3 py-2 text-right">Maintenance</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((r) => (
                <tr key={r.machineryId} className="hover:bg-navy-50/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-navy-800">{r.name}</div>
                    <div className="text-[10px] font-mono text-gray-400">{r.rapsId}{r.place ? ` · ${r.place}` : ''}</div>
                  </td>
                  <td className="px-3 py-2 w-52">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full ${barTone(r.utilizationPercent)}`} style={{ width: `${Math.min(100, r.utilizationPercent)}%` }} />
                      </div>
                      <span className={`text-xs font-semibold tabular-nums ${pctTone(r.utilizationPercent)}`}>{r.utilizationPercent}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtHrs(r.busyMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtHrs(r.idleMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtHrs(r.maintenanceMin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{fmtHrs(r.availableMin)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setReportFor(r)} className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 hover:text-navy-800">
                      <FileDown size={13} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {reportFor && (
        <ReportModal month={month} machine={reportFor} onClose={() => setReportFor(null)} />
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'text-navy-800' }) {
  return (
    <div className="rounded-xl border border-navy-100 px-3 py-2 bg-white">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
}

// Auto-generated monthly report for one machine (printable).
function ReportModal({ month, machine, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/machine-allocations/report', { params: { month, machineryId: machine.machineryId } })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [month, machine.machineryId]);

  // Times are wall-clock values stored verbatim in UTC — render UTC parts.
  const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16);
  const dstr = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'UTC' });
  const kpi = data?.kpi?.[0];

  return (
    <Modal isOpen onClose={onClose} title={`Monthly Report — ${machine.name} (${month})`} size="xl">
      {loading ? (
        <div className="flex justify-center py-10"><div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" /></div>
      ) : !data ? (
        <p className="text-sm text-gray-500">Failed to load report.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ReportStat icon={Gauge} label="Utilisation" value={kpi ? `${kpi.utilizationPercent}%` : '—'} />
            <ReportStat icon={Activity} label="Busy" value={kpi ? fmtHrs(kpi.busyMin) : '—'} />
            <ReportStat icon={Clock} label="Idle" value={kpi ? fmtHrs(kpi.idleMin) : '—'} />
            <ReportStat icon={Wrench} label="Maintenance" value={kpi ? fmtHrs(kpi.maintenanceMin) : '—'} />
          </div>
          <p className="text-xs text-gray-500">
            {machine.rapsId}{machine.place ? ` · ${machine.place}` : ''} — {data.workingDays} working days ×{' '}
            {(data.workDayMinutes / 60).toFixed(0)}h window. Generated {new Date(data.generatedAt).toLocaleString('en-IN')}.
          </p>

          <div>
            <h4 className="text-sm font-semibold text-navy-700 mb-2">Allocations ({data.allocations.length})</h4>
            {data.allocations.length === 0 ? (
              <p className="text-sm text-gray-400">No allocations this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Time</th>
                      <th className="px-2 py-1.5">Source</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5">By</th>
                      <th className="px-2 py-1.5">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.allocations.map((a) => (
                      <tr key={a.id}>
                        <td className="px-2 py-1.5 whitespace-nowrap">{dstr(a.scheduledDate)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{hhmm(a.startAt)}–{hhmm(a.endAt)}</td>
                        <td className="px-2 py-1.5">{a.sourceType === 'WORK_ORDER' ? (a.workOrder?.workOrderNumber || 'WO') : (a.ion?.ionNumber || 'ION')}</td>
                        <td className="px-2 py-1.5">{a.status}</td>
                        <td className="px-2 py-1.5">{a.allocatedBy?.name || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-600">{a.workNote || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {data.downtimes.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-navy-700 mb-2">Downtime ({data.downtimes.length})</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Time</th>
                      <th className="px-2 py-1.5">Reason</th>
                      <th className="px-2 py-1.5">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.downtimes.map((d) => (
                      <tr key={d.id}>
                        <td className="px-2 py-1.5 whitespace-nowrap">{dstr(d.scheduledDate)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{hhmm(d.startAt)}–{hhmm(d.endAt)}</td>
                        <td className="px-2 py-1.5">{d.reason}</td>
                        <td className="px-2 py-1.5 text-gray-600">{d.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t">
            <Button variant="secondary" onClick={() => window.print()}>Print</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReportStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-navy-100 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500 mb-1"><Icon size={12} /> {label}</div>
      <div className="text-xl font-bold text-navy-800">{value}</div>
    </div>
  );
}
