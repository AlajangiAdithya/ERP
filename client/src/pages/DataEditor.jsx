// DATA_EDITOR "Edit Data" page — a deliberately simple, edit-only table editor
// for non-technical staff. They pick a table, find the row, tap Edit, and change
// values in a plain labelled form (no JSON, no insert, no delete).
//
// Backed by /api/data-editor (read tables / read rows / update row only). All the
// destructive power (insert/delete/uploads/backups) lives on the SUPERADMIN page.
// The screen itself is shared with the ADMIN FIM editor — see TableWorkbench.

import { Table2 } from 'lucide-react';
import TableWorkbench from '../components/shared/TableWorkbench';

export default function DataEditor() {
  return (
    <TableWorkbench
      base="/data-editor"
      title="Edit Data"
      subtitle="Pick a table, find the row, and update its values."
      eyebrow="Data Editor"
      icon={Table2}
    />
  );
}
