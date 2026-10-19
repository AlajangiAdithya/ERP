import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ArrowLeft, AlertTriangle, Lock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell as BarCell,
} from 'recharts';
import api from '../../api/axios';
import Button from '../ui/Button';
import MachineInfoPopover from './MachineInfoPopover';

// One machine, one year, month by month. This is the "more data when I click a
// machine" view: how many hours it ran each month, how many days, and where the
// unclosed rows are.
//
// A month with no rows reads as "—", never 0. "Nothing was recorded" and "it
// ran for zero hours" are different facts, and a maintenance audit has to be
// able to tell them apart.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-navy-100 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-bold text-navy-800">{d.label}</p>
      {d.hasData ? (
        <>
          <p className="mt-0.5 tabular-nums text-navy-700">{d.hours} hours</p>
          <p className="tabular-nums text-gray-500">{d.daysRun} day{d.daysRun === 1 ? '' : 's'} run</p>
          {d.openRows > 0 && <p className="tabular-nums text-amber-700">{d.openRows} open row{d.openRows === 1 ? '' : 's'}</p>}
        </>
      ) : (
        <p className="mt-0.5 text-gray-500">Nothing recorded</p>
      )}
    </div>
  );
}

export default function MachineYearView({ machineryId, year, onChangeYear, onBack, onOpenMonth }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await api.get('/machine-work-status/year', {
        params: { machineryId, year },
      });
      setData(res ?? null);
    } catch (err) {
      setData(null);
      setError(err?.response?.data?.error || 'Could not load this year.');
    } finally {
      setLoading(false);
    }
  }, [machineryId, year]);

  useEffect(() => { load(); }, [load]);

  const machine = data?.machine;
  const total = data?.yearTotal;

  // Only offer arrows into years that actually hold data, so nobody pages
  // through empty decades looking for something.
  const canPrev = data?.dataFrom != null && year > data.dataFrom;
  const canNext = data?.dataTo != null && year < Math.max(data.dataTo, new Date().getUTCFullYear());

  const chartData = (data?.months || []).map((mo) => ({
    label: `${MONTH_SHORT[mo.monthIndex - 1]} ${year}`,
    short: MONTH_SHORT[mo.monthIndex - 1],
    hours: mo.hours,
    daysRun: mo.daysRun,
    openRows: mo.openRows,
    hasData: mo.hasData,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="md" onClick={onBack}>
          <ArrowLeft size={15} /> Back to sheet
        </Button>

        <div className="inline-flex items-center gap-1 rounded-lg border border-navy-200 bg-white p-1">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => onChangeYear(year - 1)}
            aria-label="Previous year"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-navy-600 hover:bg-navy-50
              disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[4.5rem] px-2 text-center text-sm font-semibold tabular-nums text-navy-800">{year}</span>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => onChangeYear(year + 1)}
            aria-label="Next year"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-navy-600 hover:bg-navy-50
              disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          <div className="h-20 animate-pulse rounded-2xl bg-navy-50" />
          <div className="h-56 animate-pulse rounded-2xl bg-navy-50" />
        </div>
      )}

      {!loading && data && machine && (
        <div className="overflow-hidden rounded-2xl border border-navy-100 bg-white">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-navy-100 bg-navy-50/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-navy-800">{machine.name}</p>
              <p className="font-mono text-[11px] text-gray-500">{machine.rapsId}</p>
            </div>
            <MachineInfoPopover machine={machine} />
            <div className="ml-auto flex items-center gap-3">
              {!data.canEdit && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs
                  font-semibold text-gray-600 ring-1 ring-inset ring-gray-200">
                  <Lock size={11} /> View only
                </span>
              )}
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-500">{year} total</p>
                <p className="text-xl font-bold tabular-nums text-navy-800">
                  {total.hours}<span className="ml-1 text-xs font-semibold text-gray-500">h</span>
                  <span className="ml-2 text-xs font-semibold text-gray-500">{total.daysRun} days</span>
                </p>
              </div>
            </div>
          </div>

          {/* Table first, chart second: the table is the accessible source of
              truth and screen readers get the numbers without the SVG. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="bg-navy-50">
                  {['Month', 'Hours', 'Days run', 'Avg hrs/day', 'Open rows'].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`border border-navy-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide
                        text-navy-700 ${i === 0 ? 'text-left' : 'text-right'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.months.map((mo) => (
                  <tr key={mo.month} className={mo.hasData ? 'hover:bg-navy-50/60' : 'text-gray-400'}>
                    <td className="border border-navy-100 px-3 py-1.5">
                      {mo.hasData ? (
                        <button
                          type="button"
                          onClick={() => onOpenMonth(mo.month)}
                          className="font-semibold text-blue-700 hover:underline
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                        >
                          {MONTH_SHORT[mo.monthIndex - 1]} {year}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenMonth(mo.month)}
                          className="text-gray-500 hover:text-navy-700 hover:underline
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                        >
                          {MONTH_SHORT[mo.monthIndex - 1]} {year}
                        </button>
                      )}
                    </td>
                    <td className="border border-navy-100 px-3 py-1.5 text-right font-semibold tabular-nums">
                      {mo.hasData ? mo.hours : '—'}
                    </td>
                    <td className="border border-navy-100 px-3 py-1.5 text-right tabular-nums">
                      {mo.hasData ? mo.daysRun : '—'}
                    </td>
                    <td className="border border-navy-100 px-3 py-1.5 text-right tabular-nums">
                      {mo.avgHoursPerRunDay ?? '—'}
                    </td>
                    <td className={`border border-navy-100 px-3 py-1.5 text-right tabular-nums
                      ${mo.openRows ? 'font-semibold text-amber-700' : ''}`}>
                      {mo.hasData ? mo.openRows : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-navy-50 font-semibold">
                  <td className="border border-navy-100 px-3 py-2 text-xs uppercase tracking-wide text-navy-700">Total</td>
                  <td className="border border-navy-100 px-3 py-2 text-right tabular-nums text-navy-800">{total.hours}</td>
                  <td className="border border-navy-100 px-3 py-2 text-right tabular-nums text-navy-800">{total.daysRun}</td>
                  <td className="border border-navy-100 px-3 py-2 text-right tabular-nums text-navy-800">{total.avgHoursPerRunDay ?? '—'}</td>
                  <td className="border border-navy-100 px-3 py-2 text-right tabular-nums text-navy-800">{total.openRows}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="border-t border-navy-100 p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Hours per month</p>
            {total.runMinutes === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">
                Nothing recorded for {machine.name} in {year}.
              </p>
            ) : (
              <div className="h-60" role="img" aria-label={`Hours run per month in ${year}. Totals are in the table above.`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#E5E9F0" />
                    <XAxis dataKey="short" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={{ stroke: '#CBD5E1' }} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      label={{ value: 'hours', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748B' } }}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(30,58,138,0.05)' }} />
                    <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {chartData.map((d) => (
                        // Months with open rows are tinted amber so the chart
                        // agrees with the table instead of quietly overstating.
                        <BarCell key={d.label} fill={d.openRows > 0 ? '#D97706' : '#1E3A8A'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
