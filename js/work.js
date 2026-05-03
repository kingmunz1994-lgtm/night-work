// ── Night Work — wallet, accept/submit/post task ───────────────

var walletState = { connected: false, demo: false, address: null };

async function connectLace() {
  if (typeof nightWallet === 'undefined') { connectDemo(); return; }
  try {
    const state = await nightWallet.connect('lace');
    walletState = { connected: state.connected, demo: state.demo, address: state.address };
    closeModal('ov-wallet');
    updateWalletUI();
    toast(state.demo ? '🎭 Demo mode — no real funds' : '✓ Lace connected', 'success');
  } catch (err) {
    toast('Lace not found — using demo mode', 'info');
    connectDemo();
  }
}

function connectDemo() {
  if (typeof nightWallet !== 'undefined') {
    const state = nightWallet.connect('demo');
    walletState = { connected: true, demo: true, address: typeof state.then === 'function' ? 'mn_addr_preprod1demo' : state.address };
  } else {
    walletState = { connected: true, demo: true, address: 'mn_addr_preprod1' + Math.random().toString(36).slice(2, 14) };
  }
  closeModal('ov-wallet');
  updateWalletUI();
  toast('🎭 Demo mode — no real funds', 'success');
}

function handleWalletClick() {
  if (walletState.connected) {
    if (confirm('Disconnect wallet?')) { walletState = { connected: false, demo: false, address: null }; updateWalletUI(); }
  } else { openModal('ov-wallet'); }
}

function updateWalletUI() {
  const dot = document.getElementById('wallet-dot');
  const lbl = document.getElementById('wallet-label');
  if (!dot || !lbl) return;
  dot.style.background = walletState.connected ? '#00d68f' : '#ef4444';
  lbl.textContent = walletState.connected
    ? (walletState.demo ? '🎭 Demo' : walletState.address.slice(0, 14) + '…')
    : 'Sign in';
}

async function acceptTask(id) {
  if (!walletState.connected) { openModal('ov-wallet'); return; }
  _taskState[id] = 'accepted';
  saveTaskState();
  try {
    await apiPost('/api/nightwork/accept', { taskId: id, worker: walletState.address });
  } catch { /* offline — local state only */ }
  toast('✓ Task accepted — bond locked on Midnight · complete and submit proof', 'success');
  renderTasks(_activeTab === 'available' ? 'all' : _activeTab);
}

function showProofForm(id) {
  const el = document.getElementById(`proof-form-${id}`);
  if (!el || el.innerHTML) return;
  el.innerHTML = `
    <div class="proof-form">
      <div style="font-size:11px;font-family:var(--mono);color:var(--muted);margin-bottom:8px;">Submit ZK proof of completion</div>
      <textarea id="proof-text-${id}" placeholder="Describe what you did, paste link to evidence, or enter verification code…"></textarea>
      <button class="btn btn-sm btn-green" onclick="submitTask('${id}')">⊘ Submit proof →</button>
    </div>`;
}

async function submitTask(id) {
  const text = document.getElementById(`proof-text-${id}`)?.value?.trim();
  if (!text) { toast('Add proof details', 'error'); return; }
  toast('Submitting ZK proof to Midnight…', 'info');
  try {
    await apiPost('/api/nightwork/submit', { taskId: id, proof: text, worker: walletState.address });
    toast('✓ Proof submitted — awaiting agent verification', 'success');
  } catch {
    toast('✓ Proof recorded (offline mode)', 'info');
  }
  _taskState[id] = 'submitted';
  saveTaskState();
  renderTasks(_activeTab === 'available' ? 'all' : _activeTab);
}

async function postTask() {
  if (!walletState.connected) { openModal('ov-wallet'); return; }
  const title    = document.getElementById('pt-title')?.value?.trim();
  const desc     = document.getElementById('pt-desc')?.value?.trim();
  const reward   = parseFloat(document.getElementById('pt-reward')?.value || '0');
  const deadline = document.getElementById('pt-deadline')?.value || '48';
  const bond     = parseFloat(document.getElementById('pt-bond')?.value || '10');
  if (!title || !desc) { toast('Enter task title and description', 'error'); return; }
  if (reward < 1)      { toast('Minimum reward is 1 NIGHT', 'error'); return; }

  const btn = document.getElementById('pt-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
  const circuit = document.getElementById('pt-circuit');
  if (circuit) circuit.style.display = 'flex';

  const steps = [
    { label: 'Generating ZK commitment for task…', ms: 800 },
    { label: `Locking ${bond} NIGHT agent bond on-chain…`, ms: 900 },
    { label: 'Publishing task to Night Work registry…', ms: 700 },
    { label: '✓ Task live — humans can accept', ms: 0 },
  ];
  if (circuit) circuit.innerHTML = steps.map((s,i) => `<div id="ptc-${i}"><span class="ct-dot wait" id="ptd-${i}"></span>${s.label}</div>`).join('');

  let i = 0;
  async function next() {
    if (i > 0) { const pd = document.getElementById(`ptd-${i-1}`); if (pd) pd.className = 'ct-dot done'; }
    if (i >= steps.length) {
      try {
        const result = await apiPost('/api/nightwork/post', { title, desc, reward, deadline, bond, poster: walletState.address });
        if (result.task) { _liveTasks.unshift(result.task); }
      } catch { /* offline */ }
      if (btn) { btn.disabled = false; btn.textContent = '⊘ Post task →'; }
      toast(`✓ "${title}" posted for ${reward} NIGHT`, 'success');
      switchTab('available');
      return;
    }
    const pd = document.getElementById(`ptd-${i}`);
    if (pd) pd.className = 'ct-dot active';
    const ms = steps[i].ms; i++;
    if (ms > 0) setTimeout(next, ms); else next();
  }
  next();
}

var _activeTab = 'available';
function switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const t = document.getElementById(`tab-${tab}`);
  if (t) t.classList.add('active');
  ['available','my-tasks','post'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = v === tab ? 'block' : 'none';
  });
  if (tab === 'available') { loadTasks('all').then(() => renderTasks('all')); }
  if (tab === 'my-tasks')  renderMyTasks();
}

function renderMyTasks() {
  const grid = document.getElementById('my-tasks-list');
  if (!grid) return;
  const accepted = Object.entries(_taskState).filter(([,v]) => v !== 'open');
  if (!accepted.length) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-family:var(--mono);">No tasks accepted yet — browse Available to get started.</div>';
    return;
  }
  grid.innerHTML = accepted.map(([id, status]) => {
    const t = _liveTasks.find(x => x.id === id);
    if (!t) return '';
    return `<div class="nw-task ${status}">
      <div class="nw-task-icon">${t.icon}</div>
      <div class="nw-task-info">
        <div class="nw-task-title">${t.title}</div>
        <div class="nw-task-meta">${status === 'submitted' ? '✓ Proof submitted — awaiting verification' : 'In progress — submit your proof when done'}</div>
      </div>
      <div class="nw-task-reward">${t.reward} NIGHT</div>
      <button class="nw-task-btn${status === 'submitted' ? ' submitted' : ''}" onclick="${status === 'accepted' ? `showProofForm('${id}')` : ''}" ${status === 'submitted' ? 'disabled' : ''}>
        ${status === 'submitted' ? '✓ Submitted' : 'Submit proof'}
      </button>
      <div class="nw-task-proof${status === 'accepted' ? ' show' : ''}" id="nw-proof-${id}">
        <div id="proof-form-${id}"></div>
      </div>
    </div>`;
  }).join('');
}

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  wrap.appendChild(t); setTimeout(() => t.remove(), 3500);
}

document.addEventListener('DOMContentLoaded', () => {
  updateWalletUI();
  initTasks();
  switchTab('available');
});
