// Skill Matrix — per-employee rating across 15 fixed competencies (0–4 scale).
// HR/ADMIN edit ratings; everyone else view-only.
import { useEffect, useMemo, useState } from 'react';
import { Grid3x3, Save, Upload, FileText, Search } from 'lucide-react';
import api from '../../api/axios';

const SKILLS = [
  { key: 'qmsAwareness',         label: 'QMS Awareness' },
  { key: 'risksOpportunities',   label: 'Risks & Opportunities' },
  { key: 'processKnowledge',     label: 'Process Knowledge' },
  { key: 'inspectionTesting',    label: 'Inspection & Testing' },
  { key: 'qualityAnalytical',    label: 'Quality / Analytical' },
  { key: 'nonconformityAnalysis',label: 'Nonconformity Analysis' },
  { key: 'customerRelations',    label: 'Customer Relations' },
  { key: 'supplierManagement',   label: 'Supplier Management' },
  { key: 'projectPlanning',      label: 'Project Planning' },
  { key: 'equipmentMaintenance', label: 'Equipment Maintenance' },
  { key: 'materialInventory',    label: 'Material Inventory' },
  { key: 'internalAuditing',     label: 'Internal Auditing' },
  { key: 'crisisManagement',     label: 'Crisis Management' },
  { key: 'communicationSkills',  label: 'Communication Skills' },
  { key: 'interPersonalRelations', label: 'Inter-Personal Relations' },
];

const RATING_HINT = '0 = no exposure · 1 = aware · 2 = can perform with help · 3 = independent · 4 = expert / can train others';

export default function SkillMatrix() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({}); // { [employeeId]: { skillKey: number, trainingNeeds, remarks } }
  const [savingId, setSavingId] = useState(null);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/skill-matrix');
      setEmployees(data.employees || []);
      setCanWrite(!!data.canWrite);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((e) =>
      [e.empCode, e.name, e.designation, e.category]
        .filter(Boolean).some((s) => s.toLowerCase().includes(term))
    );
  }, [employees, search]);

  const getCellValue = (emp, key) => {
    const draft = drafts[emp.id]?.[key];
    if (draft !== undefined) return draft;
    return emp.skillMatrix?.[key] ?? '';
  };

  const setCellValue = (empId, key, value) => {
    setDrafts((d) => ({ ...d, [empId]: { ...(d[empId] || {}), [key]: value } }));
  };

  const isDirty = (empId) => !!drafts[empId] && Object.keys(drafts[empId]).length > 0;

  const saveRow = async (emp) => {
    if (!isDirty(emp.id)) return;
    setSavingId(emp.id);
    try {
      const body = { ...drafts[emp.id] };
      // sanitize numeric ratings
      for (const s of SKILLS) {
        if (body[s.key] !== undefined && body[s.key] !== '') {
          const n = parseFloat(body[s.key]);
          body[s.key] = Number.isFinite(n) ? n : null;
        }
      }
      const { data } = await api.put(`/skill-matrix/${emp.id}`, body);
      setEmployees((arr) => arr.map((x) => x.id === emp.id ? { ...x, skillMatrix: data } : x));
      setDrafts((d) => { const { [emp.id]: _, ...rest } = d; return rest; });
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setSavingId(null); }
  };

  const uploadHodSign = async (emp, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/skill-matrix/${emp.id}/hod-sign`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setEmployees((arr) => arr.map((x) => x.id === emp.id ? { ...x, skillMatrix: data } : x));
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-purple-700 text-white p-5 shadow">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-violet-100/80">
          <Grid3x3 size={13} /> HR · Skill Matrix
        </div>
        <div className="text-xl font-bold mt-1">Skill Matrix</div>
        <div className="text-xs text-violet-100/80 mt-0.5">Department-wise skill ratings (0–4). {RATING_HINT}</div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
        </div>

        {err && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{err}</div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50 sticky top-0">
                <th className="py-2 px-2 sticky left-0 bg-gray-50 z-10">#</th>
                <th className="py-2 px-2 sticky left-8 bg-gray-50 z-10 min-w-[160px]">Employee</th>
                <th className="py-2 px-2 min-w-[90px]">Code</th>
                <th className="py-2 px-2 min-w-[90px]">Date of Joining</th>
                {SKILLS.map((s) => (
                  <th key={s.key} className="py-2 px-2 text-center whitespace-nowrap" title={s.label}>
                    {s.label.split(' ').map((w, i) => <div key={i}>{w}</div>)}
                  </th>
                ))}
                <th className="py-2 px-2 min-w-[140px]">Training Needs</th>
                <th className="py-2 px-2 min-w-[120px]">Remarks</th>
                <th className="py-2 px-2 min-w-[100px]">HoD Sign</th>
                {canWrite && <th className="py-2 px-2 text-right min-w-[80px]">Save</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={SKILLS.length + 7} className="py-6 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={SKILLS.length + 7} className="py-6 text-center text-gray-400">No employees.</td></tr>
              ) : filtered.map((emp) => {
                const rowEdit = !!emp.canEdit;
                return (
                <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="py-1.5 px-2 sticky left-0 bg-white text-gray-500">{emp.serialNo}</td>
                  <td className="py-1.5 px-2 sticky left-8 bg-white">
                    <div className="font-semibold text-navy-900 truncate">{emp.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{emp.designation || emp.category || ''}</div>
                  </td>
                  <td className="py-1.5 px-2 font-mono text-[10px] text-gray-700">{emp.empCode || '—'}</td>
                  <td className="py-1.5 px-2 text-[10px] text-gray-700">{emp.dateOfJoining ? emp.dateOfJoining.slice(0, 10) : '—'}</td>
                  {SKILLS.map((s) => (
                    <td key={s.key} className="py-1 px-1 text-center">
                      <input
                        type="number" min={0} max={4} step={0.5}
                        value={getCellValue(emp, s.key)}
                        disabled={!rowEdit}
                        onChange={(e) => setCellValue(emp.id, s.key, e.target.value)}
                        className="w-12 px-1 py-1 text-center border border-gray-200 rounded text-xs disabled:bg-gray-50 disabled:text-gray-700"
                      />
                    </td>
                  ))}
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      value={drafts[emp.id]?.trainingNeeds ?? emp.skillMatrix?.trainingNeeds ?? ''}
                      disabled={!rowEdit}
                      onChange={(e) => setCellValue(emp.id, 'trainingNeeds', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      value={drafts[emp.id]?.remarks ?? emp.skillMatrix?.remarks ?? ''}
                      disabled={!rowEdit}
                      onChange={(e) => setCellValue(emp.id, 'remarks', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
                    />
                  </td>
                  <td className="py-1 px-2 text-center">
                    {emp.skillMatrix?.headOfDeptSig ? (
                      <a href={emp.skillMatrix.headOfDeptSig} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">
                        <FileText size={12} /> View
                      </a>
                    ) : <span className="text-gray-400">—</span>}
                    {rowEdit && (
                      <label className="block mt-1 cursor-pointer text-[10px] text-violet-700 hover:underline">
                        <span className="inline-flex items-center gap-1"><Upload size={10} /> Upload</span>
                        <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => uploadHodSign(emp, e.target.files[0])} />
                      </label>
                    )}
                  </td>
                  {canWrite && (
                    <td className="py-1 px-2 text-right">
                      {rowEdit ? (
                        <button
                          onClick={() => saveRow(emp)}
                          disabled={!isDirty(emp.id) || savingId === emp.id}
                          className="px-2 py-1 text-xs rounded bg-violet-700 hover:bg-violet-800 text-white disabled:opacity-30 inline-flex items-center gap-1"
                        >
                          <Save size={11} /> {savingId === emp.id ? '…' : 'Save'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400">Fixed</span>
                      )}
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
