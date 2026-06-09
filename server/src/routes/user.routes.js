const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');

const router = express.Router();

const VALID_ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB',
  'METROLOGY', 'NDT', 'RND', 'SAFETY', 'SUPPLY_CHAIN',
  'DESIGNS', 'FINANCE', 'PLANNING', 'LOGISTICS', 'SITE_OFFICE', 'HR',
];

const createUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
  role: z.string().refine(val => VALID_ROLES.includes(val), { message: 'Invalid role' }),
  unitId: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  role: z.string().refine(val => VALID_ROLES.includes(val), { message: 'Invalid role' }).optional(),
  unitId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// GET /api/users/managers — lightweight list of active managers.
// Used by the ION recipient picker (MANAGER/LAB).
router.get('/managers', authenticate, authorize('MANAGER', 'LAB', 'ADMIN'), async (req, res) => {
  try {
    const excludeSelf = ['MANAGER', 'LAB'].includes(req.user.role);
    const managers = await prisma.user.findMany({
      where: {
        role: 'MANAGER', isActive: true,
        ...(excludeSelf ? { NOT: { id: req.user.id } } : {}),
      },
      select: {
        id: true, name: true, username: true, unitId: true,
        unit: { select: { id: true, name: true, code: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(managers);
  } catch (error) {
    console.error('List managers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users
router.get('/', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      // SUPERADMIN account is never returned here — only its own session can see it.
      where: req.user.role === 'SUPERADMIN' ? {} : { role: { not: 'SUPERADMIN' } },
      select: {
        id: true, username: true, name: true, role: true,
        unitId: true, unit: { select: { id: true, name: true, code: true } },
        isActive: true, createdAt: true, plainPassword: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    // Hide plainPassword for admin users
    const sanitized = users.map(u => ({
      ...u,
      plainPassword: u.role === 'ADMIN' ? null : u.plainPassword,
    }));
    res.json(sanitized);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users
router.post('/', authenticate, authorize('ADMIN'), auditLog('CREATE', 'User'), async (req, res) => {
  try {
    const data = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);

    const role = data.role;
    const user = await prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        plainPassword: role !== 'ADMIN' ? data.password : null,
        name: data.username,
        role,
        unitId: data.unitId || null,
      },
      select: {
        id: true, username: true, name: true, role: true,
        unitId: true, unit: { select: { id: true, name: true, code: true } },
        isActive: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Fixed admin usernames that cannot be modified or removed ──
const FIXED_ADMIN_USERNAMES = ['madhubabu', 'sureshbabu', 'rameshbabu'];

// PUT /api/users/:id
router.put('/:id', authenticate, authorize('ADMIN'), auditLog('UPDATE', 'User'), async (req, res) => {
  try {
    const data = updateUserSchema.parse(req.body);

    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // ── Fixed admins are completely protected — no modifications allowed ──
    if (FIXED_ADMIN_USERNAMES.includes(targetUser.username)) {
      return res.status(403).json({ error: 'This is a fixed admin account and cannot be modified' });
    }

    // ── Prevent any admin from demoting/deactivating themselves ──
    if (targetUser.role === 'ADMIN' && targetUser.id === req.user.id) {
      if (data.role !== undefined && data.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admins cannot demote themselves' });
      }
      if (data.isActive === false) {
        return res.status(403).json({ error: 'Admins cannot deactivate themselves' });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, username: true, name: true, role: true,
        unitId: true, unit: { select: { id: true, name: true, code: true } },
        isActive: true,
      },
    });
    res.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/password
router.put('/:id/password', authenticate, async (req, res) => {
  try {
    if (req.user.id !== req.params.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.user.id === req.params.id) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        passwordHash,
        plainPassword: user.role !== 'ADMIN' ? newPassword : null,
      },
    });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    if (FIXED_ADMIN_USERNAMES.includes(targetUser.username)) {
      return res.status(403).json({ error: 'This is a fixed admin account and cannot be deleted' });
    }

    if (targetUser.id === req.user.id) {
      return res.status(403).json({ error: 'You cannot delete your own account' });
    }

    // Sessions cascade-delete, audit logs & requests set userId to null
    await prisma.user.delete({ where: { id: req.params.id } });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user: ' + error.message });
  }
});

module.exports = router;
