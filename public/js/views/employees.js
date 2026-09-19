import { api } from '../api.js';
import { render, pageLoading, escapeHtml, fmtDate, field, openModal, closeModal, setBusy, toast, emptyState, deniedPanel } from '../util.js';
import { link } from '../router.js';

export function employeeCanManageMe(me, employee) {
  if (!employee) return false;
  if (me.role === 'ADMIN') return true;
  if (employee.userId && employee.userId === me.id) return true; // self
  return false; // managers manage direct reports only, resolved server-side
}

export async function mountEmployees(container, session) {
  pageLoading(container);
  let data;
  try {
    data = await api.get('/api/employees');
  } catch (err) {
    render(container, `<div class="page">${err && err.status === 403 ? deniedPanel(err.message) : `<div class="alert error">${escapeHtml(err.message || 'Could not load employees')}</div>`}</div>`);
    return;
  }
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const isAdmin = session.user.role === 'ADMIN';

  render(container, `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Employees</h1>
          <div class="sub">${isAdmin ? 'All employees' : session.user.role === 'MANAGER' ? 'Your record and your direct reports' : 'Your employee record'} · ${employees.length} shown</div>
        </div>
        ${isAdmin ? '<button class="btn" id="btn-new-employee">New employee</button>' : ''}
      </div>

      ${employees.length === 0
        ? emptyState('No employees found.', session.user.role === 'ADMIN' ? 'Create the first employee record to begin.' : 'Your account is not yet linked to an employee record.')
        : `<div class="panel" style="padding:8px 12px">
            <table class="tbl">
              <thead><tr><th>Name</th><th>Department</th><th>Title</th><th>Link</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                ${employees.map((e) => `
                  <tr>
                    <td><strong>${escapeHtml(e.fullName)}</strong></td>
                    <td>${escapeHtml(e.department)}</td>
                    <td>${escapeHtml(e.title)}</td>
                    <td>${e.userId ? '<span class="badge ok">linked</span>' : '<span class="badge muted">none</span>'}</td>
                    <td class="small muted">${fmtDate(e.updatedAt)}</td>
                    <td class="right">${link(`employees/${e.id}`, 'Open', 'btn secondary small')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
    </div>
  `);

  const newBtn = container.querySelector('#btn-new-employee');
  if (newBtn) newBtn.addEventListener('click', () => openCreateModal(container, employees, session));
}

function openCreateModal(container, employees, session) {
  const managerOptions = employees
    .map((e) => `<option value="${e.id}">${escapeHtml(e.fullName)}</option>`)
    .join('');
  const body = `
    <form id="create-emp-form" novalidate>
      ${field('Full name', '<input name="fullName" required maxlength="160" />')}
      ${field('Department', '<input name="department" required maxlength="160" />')}
      ${field('Title', '<input name="title" required maxlength="160" />')}
      ${field('Email (optional)', '<input name="email" type="email" maxlength="254" />')}
      ${field('Reports to (manager)', `<select name="managedBy"><option value="">— none —</option>${managerOptions}</select>`)}
      ${field('Linked user UUID (optional)', '<input name="userId" placeholder="00000000-0000-4000-8000-000000000000" />', 'Links this record to an existing user account. Usually left empty; the admin can link a user later.')}
      <div id="create-emp-err" class="alert error hidden"></div>
    </form>`;
  openModal({
    title: 'New employee',
    body,
    actions: `
      <button class="btn secondary" data-modal-cancel>Cancel</button>
      <button class="btn" id="create-emp-ok" type="submit">Create</button>
    `,
  });

  const modal = document.getElementById('modal-host');
  modal.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
  modal.querySelector('#create-emp-ok').addEventListener('click', async () => {
    const form = modal.querySelector('#create-emp-form');
    const errBox = modal.querySelector('#create-emp-err');
    errBox.classList.add('hidden');
    const payload = {
      fullName: form.fullName.value.trim(),
      department: form.department.value.trim(),
      title: form.title.value.trim(),
      email: form.email.value.trim() || null,
      managedBy: form.managedBy.value || null,
      userId: form.userId.value.trim() || null,
    };
    if (!payload.fullName || !payload.department || !payload.title) {
      errBox.textContent = 'Full name, department and title are required.';
      errBox.classList.remove('hidden');
      return;
    }
    const btn = modal.querySelector('#create-emp-ok');
    setBusy(btn, true, 'Creating…');
    try {
      const created = await api.post('/api/employees', payload);
      closeModal();
      toast(`Employee ${created.employee.fullName} created`, 'ok');
      if (container.isConnected) {
        await mountEmployees(container, session);
      } else {
        window.location.hash = '#/employees';
      }
    } catch (err) {
      errBox.textContent = err.message || 'Creation failed.';
      errBox.classList.remove('hidden');
    } finally {
      setBusy(btn, false);
    }
  });
}