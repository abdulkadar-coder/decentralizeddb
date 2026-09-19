import type { Role } from './auth/tokens.js';

export interface Actor {
  userId: string;
  username: string;
  role: Role;
  employeeId?: string | null;
}

export interface EmployeeLike {
  id: string;
  user_id: string | null;
  managed_by: string | null;
  department?: string;
}

export interface DocumentLike {
  employee_id: string;
}

/** A manager's scope is the set of employees whose `managed_by` is their employee id. */
function isDirectReport(actor: Actor, employee: EmployeeLike): boolean {
  return Boolean(
    actor.employeeId && employee.managed_by && actor.employeeId === employee.managed_by,
  );
}

function isSelf(actor: Actor, employee: EmployeeLike): boolean {
  return Boolean(actor.userId && employee.user_id && actor.userId === employee.user_id);
}

/** Who may READ an employee record. */
export function canViewEmployee(actor: Actor, employee: EmployeeLike): boolean {
  if (actor.role === 'ADMIN') return true;
  if (actor.role === 'MANAGER') return isDirectReport(actor, employee);
  return isSelf(actor, employee);
}

/** Who may WRITE/changes to an employee record. */
export function canManageEmployee(actor: Actor, employee: EmployeeLike): boolean {
  if (actor.role === 'ADMIN') return true;
  if (actor.role === 'MANAGER') return isDirectReport(actor, employee);
  return isSelf(actor, employee);
}

/** Who may ACCESS a document belonging to an employee. */
export function canAccessDocument(actor: Actor, employee: EmployeeLike, _doc: DocumentLike): boolean {
  if (actor.role === 'ADMIN') return true;
  if (actor.role === 'MANAGER') return isDirectReport(actor, employee);
  return isSelf(actor, employee);
}

/** A manager's listing scope includes themselves and their direct reports. */
export function canListUnder(actor: Actor, employee: EmployeeLike): boolean {
  if (actor.role === 'ADMIN') return true;
  if (actor.role === 'MANAGER') {
    return isDirectReport(actor, employee) || isSelf(actor, employee);
  }
  return isSelf(actor, employee);
}