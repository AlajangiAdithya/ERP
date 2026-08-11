// ADMIN "FIM Data" page — full edit access over FIM / customer-property records.
//
// Scoped deliberately: the server (/api/fim-editor) only publishes the four FIM
// tables — the register entries, their lines, the stock batches the material
// produced, and the customer test certificates — so this is not a back door
// onto the rest of the database. Within those, an admin can add, edit and
// delete, and every action is audit-logged against their name.

import { FileInput } from 'lucide-react';
import TableWorkbench from '../components/shared/TableWorkbench';

export default function FimDataEditor() {
  return (
    <TableWorkbench
      base="/fim-editor"
      title="FIM Data"
      subtitle="Correct any FIM / customer-property record — entries, line items, batches and test reports."
      eyebrow="Admin"
      icon={FileInput}
      note="Changes here write straight to the FIM records used across Stores, the FIM register and the product FIM tab. Every add, edit and delete is recorded in the audit log against your account."
      allowInsert
      allowDelete
      emptyHint="Choose a FIM table to begin."
    />
  );
}
