import { z } from 'zod';

export const idSchema = z.string().uuid('expected a UUID');

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'username must be at least 3 characters')
    .max(40)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'username may contain letters, digits, dot, dash, underscore'),
  displayName: z.string().min(1).max(80),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  code: z.string().length(6, 'TOTP code must be 6 digits').regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

export const totpSetupSchema = z.object({});

export const totpVerifySchema = z.object({
  code: z.string().length(6, 'TOTP code must be 6 digits').regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

export const totpDisableSchema = z.object({
  recoveryCode: z.string().min(1, 'Recovery code required'),
});

export const recoveryLoginSchema = z.object({
  username: z.string().min(1),
  recoveryCode: z.string().min(1, 'Recovery code required'),
});

export const smsSendSchema = z.object({
  username: z.string().min(1).max(40),
});

export const smsVerifySchema = z.object({
  username: z.string().min(1).max(40),
  code: z.string().length(6, 'SMS code must be 6 digits').regex(/^\d{6}$/, 'SMS code must be 6 digits'),
});

export const employeeCreateSchema = z.object({
  fullName: z.string().min(1).max(160),
  department: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  email: z.string().email().max(254).nullable().optional(),
  managedBy: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
});

export const employeeUpdateSchema = z
  .object({
    fullName: z.string().min(1).max(160).optional(),
    department: z.string().min(1).max(160).optional(),
    title: z.string().min(1).max(160).optional(),
    email: z.string().email().max(254).nullable().optional(),
    managedBy: z.string().uuid().nullable().optional(),
    userId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });

export const roleChangeSchema = z.object({ role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']) });

export const documentUploadHeaders = {
  filename: z.string().min(1).max(255),
};