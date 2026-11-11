// DATA_EDITOR "Edit Data" page - a deliberately simple table editor for
// non-technical staff. They pick a table, find the row, and either tap Edit to
// change values in a plain labelled form (no JSON) or delete the row.
//
// Backed by /api/data-editor (read tables / read rows / update / delete row).
// Insert, uploads and backups stay on the SUPERADMIN page, and the server refuses
// deletes on User / Session / AuditLog.
// The screen itself is shared with the ADMIN FIM editor - see TableWorkbench.

import { Table2 } from 'lucide-react';
import TableWorkbench from '../components/shared/TableWorkbench';

export default function DataEditor() {
  return (
    <TableWorkbench
      base="/data-editor"
      title="Edit Data"
      subtitle="Pick a table, find the row, and update or delete it."
      eyebrow="Data Editor"
      icon={Table2}
      allowDelete
    />
  );
}
