import { api } from '../api.js';
import { render, pageLoading, escapeHtml, fmtDate, fmtBytes, maskId, field, openModal, closeModal, setBusy, toast, toastError, confirmDialog, deniedPanel } from '../util.js';
import { navigate, link } from '../router.js';

const ROLES = ['EMPLOYEE', 'MANAGER', 'ADMIN'];

export async function mountEmployee(container, session, id) {
  pageLoading(container);
  let employee;
  try {
    employee = (await api.get(`/api/employees/${id}`)).employee;
  } catch (err) {
    render(container, `<div class="page">${err && err.status === 403 ? deniedPanel(err.message) : `<div class="alert error">${escapeHtml(err.message || 'Employee not found')}</div>`}</div>`);
    return;
  }

  const isAdmin = session.user.role === 'ADMIN';
  const isSelf = Boolean(employee.userId && employee.userId === session.user.id);
  const canManage = isAdmin || isSelf || session.user.role === 'MANAGER';

  let documents = [];
  try {
    documents = (await api.get(`/api/employees/${id}/documents`)).documents || [];
  } catch (err) {
    toastError(err, 'Could not load documents');
  }

  render(container, `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>${escapeHtml(employee.fullName)}</h1>
          <div class="sub">${escapeHtml(employee.department)} · ${escapeHtml(employee.title)}</div>
        </div>
        <div class="chip-row">
          ${link('employees', '← Employees', 'btn secondary small')}
          ${isAdmin ? `<button class="btn danger small" id="btn-delete-emp">Delete</button>` : ''}
        </div>
      </div>

      <div class="grid cols-2">
        <div class="panel">
          <h2>Employee record</h2>
          <div class="kv">
            <dt>ID</dt><dd class="mono">${escapeHtml(maskId(employee.id))}</dd>
            <dt>Email</dt><dd>${employee.email ? escapeHtml(employee.email) : '—'}</dd>
            <dt>Reports to</dt><dd>${employee.managedBy ? escapeHtml(maskId(employee.managedBy)) : '—'}</dd>
            <dt>Linked user</dt><dd>${employee.userId ? '<span class="badge ok">linked</span>' : '<span class="badge muted">none</span>'}</dd>
            <dt>Version</dt><dd>${employee.version}</dd>
            <dt>Created</dt><dd class="small">${fmtDate(employee.createdAt)}</dd>
            <dt>Updated</dt><dd class="small">${fmtDate(employee.updatedAt)}</dd>
          </div>
          <div class="mt" style="display:flex;gap:10px;flex-wrap:wrap">
            ${canManage ? '<button class="btn" id="btn-edit-emp">Edit record</button>' : ''}
            ${isAdmin && employee.userId ? '<button class="btn secondary" id="btn-role-emp">Change role</button>' : ''}
          </div>
        </div>

        <div class="panel">
          <h2>Documents ${(documents.length ? `· ${documents.length}` : '')}</h2>
          ${canManage ? `
            <label class="btn secondary small" style="cursor:pointer;margin-bottom:12px">
              Upload document
              <input type="file" id="doc-file" class="hidden" />
            </label>
          ` : ''}
          ${documents.length === 0
            ? '<div class="muted small">No documents yet.</div>'
            : `<table class="tbl">
                <thead><tr><th>File</th><th>Size</th><th>Status</th><th>Uploaded</th><th></th></tr></thead>
                <tbody>
                  ${documents.map((d) => `
                    <tr>
                      <td><strong>${escapeHtml(d.filename)}</strong><div class="small muted">${escapeHtml(d.contentType)}</div></td>
                      <td class="small">${fmtBytes(d.sizeBytes)}</td>
                      <td>${d.status === 'ACTIVE' ? '<span class="badge ok">active</span>' : '<span class="badge muted">revoked</span>'}</td>
                      <td class="small muted">${fmtDate(d.uploadedAt)}</td>
                      <td>
                        ${d.status === 'ACTIVE'
                          ? `<button class="btn secondary small" data-dl="${escapeHtml(d.id)}">Download</button>
                             <button class="btn danger small" data-rm="${escapeHtml(d.id)}">Revoke</button>`
                          : '<span class="muted small">revoked</span>'}
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>`}
          ${canManage ? '<div class="proto-note">Uploaded bytes are encrypted before storage; downloads are decrypted and verified on every request.</div>' : ''}
        </div>
      </div>
    </div>
  `);

  bindDetailActions(container, session, employee, documents);
}

function bindDetailActions(container, session, employee, documents) {
  const fileInput = container.querySelector('#doc-file');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const label = container.querySelector('label[for="doc-file"]');
      setBusy(label, true, 'Uploading…');
      try {
        const res = await api.uploadFile(`/api/employees/${employee.id}/documents`, file);
        toast(`Uploaded ${res.document.filename}`, 'ok');
        mountEmployee(container, session, employee.id);
      } catch (err) {
        toastError(err, 'Upload failed');
      } finally {
        fileInput.value = '';
        setBusy(label, false);
      }
    });
  }

  container.querySelectorAll('[data-dl]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const doc = documents.find((d) => d.id === btn.getAttribute('data-dl'));
      if (!doc) return;
      setBusy(btn, true, 'Downloading…');
      try {
        const blob = await api.download(`/api/employees/${employee.id}/documents/${doc.id}`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.filename || 'document';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('Download started (access recorded in the audit trail).', 'info');
      } catch (err) {
        toastError(err, 'Download failed');
      } finally {
        setBusy(btn, false);
      }
    });
  });

  container.querySelectorAll('[data-rm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const doc = documents.find((d) => d.id === btn.getAttribute('data-rm'));
      if (!doc) return;
      const ok = await confirmDialog(`Revoke "${doc.filename}"? Its ciphertext will be purged from object storage and the download will become unavailable.`);
      if (!ok) return;
      setBusy(btn, true, 'Revoking…');
      try {
        await api.del(`/api/employees/${employee.id}/documents/${doc.id}`);
        toast('Document revoked and storage object purged.', 'ok');
        mountEmployee(container, session, employee.id);
      } catch (err) {
        toastError(err, 'Revoke failed');
        setBusy(btn, false);
      }
    });
  });

  const editBtn = container.querySelector('#btn-edit-emp');
  if (editBtn) editBtn.addEventListener('click', () => openEditModal(container, session, employee));

  const roleBtn = container.querySelector('#btn-role-emp');
  if (roleBtn) roleBtn.addEventListener('click', () => openRoleModal(container, session, employee));

  const delBtn = container.querySelector('#btn-delete-emp');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog(`Delete ${employee.fullName}? The record is removed from the directory and any linked user account is deactivated (meta-only audit block is kept).`);
      if (!ok) return;
      setBusy(delBtn, true, 'Deleting…');
      try {
        await api.del(`/api/employees/${employee.id}`);
        toast('Employee deleted.', 'ok');
        navigate('employees');
      } catch (err) {
        toastError(err, 'Delete failed');
        setBusy(delBtn, false);
      }
    });
  }
}

function openEditModal(container, session, employee) {
  const isAdmin = session.user.role === 'ADMIN';
  const body = `
    <form id="edit-emp-form" novalidate>
      ${field('Full name', `<input name="fullName" required maxlength="160" value="${escapeAttr(employee.fullName)}" />`)}
      ${field('Department', `<input name="department" required maxlength="160" value="${escapeAttr(employee.department)}" />`)}
      ${field('Title', `<input name="title" required maxlength="160" value="${escapeAttr(employee.title)}" />`)}
      ${field('Email (optional)', `<input name="email" type="email" maxlength="254" value="${escapeAttr(employee.email || '')}" />`)}
      ${isAdmin
        ? field('Reports to (manager UUID)', `<input name="managedBy" value="${escapeAttr(employee.managedBy || '')}" placeholder="employee UUID or empty" />`)
        : ''}
      ${isAdmin
        ? field('Linked user UUID', `<input name="userId" value="${escapeAttr(employee.userId || '')}" placeholder="user UUID or empty" />`, 'Admin-only: changing the link moves ownership.')
        : ''}
      <div id="edit-emp-err" class="alert error hidden"></div>
    </form>`;
  openModal({
    title: `Edit ${employee.fullName}`,
    body,
    actions: `
      <button class="btn secondary" data-modal-cancel>Cancel</button>
      <button class="btn" id="edit-emp-ok" type="submit">Save</button>
    `,
  });
  const modal = document.getElementById('modal-host');
  modal.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
  modal.querySelector('#edit-emp-ok').addEventListener('click', async () => {
    const form = modal.querySelector('#edit-emp-form');
    const errBox = modal.querySelector('#edit-emp-err');
    errBox.classList.add('hidden');
    const payload = {
      fullName: form.fullName.value.trim(),
      department: form.department.value.trim(),
      title: form.title.value.trim(),
      email: form.email.value.trim() || null,
    };
    if (isAdmin) {
      payload.managedBy = form.managedBy.value.trim() || null;
      payload.userId = form.userId.value.trim() || null;
    }
    if (!payload.fullName || !payload.department || !payload.title) {
      errBox.textContent = 'Full name, department and title are required.';
      errBox.classList.remove('hidden');
      return;
    }
    const btn = modal.querySelector('#edit-emp-ok');
    setBusy(btn, true, 'Saving…');
    try {
      await api.patch(`/api/employees/${employee.id}`, payload);
      closeModal();
      toast('Employee updated.', 'ok');
      mountEmployee(container, session, employee.id);
    } catch (err) {
      errBox.textContent = err.message || 'Update failed.';
      errBox.classList.remove('hidden');
    } finally {
      setBusy(btn, false);
    }
  });
}

function openRoleModal(container, session, employee) {
  const body = `
    <form id="role-form" novalidate>
      ${field('New role', `
        <select name="role">
          ${ROLES.map((r) => `<option value="${r}" ${r === session.user.role ? '' : ''}>${r}</option>`).join('')}
        </select>`, 'Fresh-identity RBAC means the change applies immediately — no re-login required.')}
      <div id="role-err" class="alert error hidden"></div>
    </form>`;
  openModal({
    title: `Change role for ${employee.fullName}`,
    body,
    actions: `
      <button class="btn secondary" data-modal-cancel>Cancel</button>
      <button class="btn" id="role-ok" type="submit">Change role</button>
    `,
  });
  const modal = document.getElementById('modal-host');
  modal.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
  modal.querySelector('#role-ok').addEventListener('click', async () => {
    const role = modal.querySelector('#role-form select[name="role"]').value;
    const errBox = modal.querySelector('#role-err');
    errBox.classList.add('hidden');
    const btn = modal.querySelector('#role-ok');
    setBusy(btn, true, 'Saving…');
    try {
      await api.post(`/api/employees/${employee.id}/role`, { role });
      closeModal();
      toast(`Role changed to ${role}.`, 'ok');
      mountEmployee(container, session, employee.id);
    } catch (err) {
      errBox.textContent = err.message || 'Role change failed.';
      errBox.classList.remove('hidden');
    } finally {
      setBusy(btn, false);
    }
  });
}

function escapeAttr(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}