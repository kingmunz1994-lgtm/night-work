// Night ecosystem wallet connector — DApp Connector v4
// Supports: Lace (mnLace legacy), 1AM / GSD / Nocturne (UUID midnight#ready)

var nightWallet = (function () {
  var _state = { connected: false, demo: false, address: null, night: 0, dust: 0, api: null };
  var _listeners = [];
  var _pollTimer = null;

  function _notify() { _listeners.forEach(function(fn){ try { fn({ ..._state }); } catch(e){} }); }

  function onStateChange(fn) { _listeners.push(fn); }

  function hasWallet() { return !!(window.midnight && Object.values(window.midnight).some(function(w){ return w && typeof w.connect === 'function'; })); }

  function parseDustAmt(raw) {
    if (!raw) return 0;
    if (typeof raw === 'bigint') return Number(raw);
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') return Number(raw) || 0;
    if (typeof raw === 'object') {
      const v = raw.value ?? raw.amount ?? raw.balance ?? raw.dust;
      if (v !== undefined) return parseDustAmt(v);
      const vals = Object.values(raw);
      if (vals.length === 1) return parseDustAmt(vals[0]);
    }
    return 0;
  }

  async function connectLace() {
    const m = window.midnight;
    if (!m) throw new Error('Midnight wallet not found — install Lace, 1AM, or Nocturne.');
    // v4 spec: window.midnight[uuid] = { connect, name, rdns, apiVersion }
    // Legacy: window.midnight.mnLace
    let walletEntry = null;
    if (m.mnLace && typeof m.mnLace.connect === 'function') walletEntry = m.mnLace;
    else {
      const key = Object.keys(m).find(function(k){ return m[k] && typeof m[k].connect === 'function'; });
      if (key) walletEntry = m[key];
    }
    if (!walletEntry) throw new Error('No compatible Midnight wallet found in window.midnight.');

    let api = null;
    for (const net of ['mainnet', 'preprod', 'undeployed']) {
      try { api = await walletEntry.connect(net); if (api) break; } catch(e) {}
    }
    if (!api) throw new Error('Connection rejected — please approve in your wallet.');

    let address = null;
    let night = 0, dust = 0;

    // Address — try unshielded first, fall back to shielded
    try {
      const r = await api.getUnshieldedAddress();
      address = (r && typeof r === 'object') ? (r.unshieldedAddress || r.address || null) : (r || null);
    } catch(e) {}
    if (!address) {
      try {
        const r = await api.getShieldedAddresses();
        const first = Array.isArray(r) ? r[0] : r;
        address = first?.shieldedAddress || null;
      } catch(e) {}
    }
    address = address || 'mn_addr_unknown';

    // Balances — robust parsing
    try { dust = parseDustAmt(await api.getDustBalance()); } catch(e) {}
    try {
      const ub = await api.getUnshieldedBalances();
      if (ub) { const k = Object.keys(ub); if (k.length) night = Number(ub[k[0]]) / 1e6 || 0; }
    } catch(e) {}

    _state = { connected: true, demo: false, address, night, dust, api };
    _notify();
    _startPoll(api);
    return { ..._state };
  }

  function _startPoll(api) {
    if (_pollTimer) clearInterval(_pollTimer);
    let failures = 0;
    _pollTimer = setInterval(async function() {
      if (!_state.connected || _state.demo) { clearInterval(_pollTimer); return; }
      try {
        let dust = 0, night = 0;
        try { dust = parseDustAmt(await api.getDustBalance()); } catch(e) {}
        try {
          const ub = await api.getUnshieldedBalances();
          if (ub) { const k = Object.keys(ub); if (k.length) night = Number(ub[k[0]]) / 1e6 || 0; }
        } catch(e) {}
        failures = 0;
        if (dust !== _state.dust || night !== _state.night) {
          _state = { ..._state, dust, night };
          _notify();
        }
      } catch(e) {
        failures++;
        if (failures >= 3) clearInterval(_pollTimer); // stop spamming if wallet locked
      }
    }, 8000);
  }

  function connectDemo() {
    _state = {
      connected: true, demo: true,
      address: 'mn_addr_preprod1' + Math.random().toString(36).slice(2, 14),
      night: 50000, dust: 1000, api: null,
    };
    _notify();
    return { ..._state };
  }

  async function connect(mode) {
    if (mode === 'demo') return connectDemo();
    return connectLace();
  }

  function disconnect() {
    if (_pollTimer) clearInterval(_pollTimer);
    _state = { connected: false, demo: false, address: null, night: 0, dust: 0, api: null };
    _notify();
  }

  function getState()    { return { ..._state }; }
  function isConnected() { return _state.connected; }
  function isDemo()      { return _state.demo; }
  function getAddress()  { return _state.address; }

  // Listen for wallets that inject after page load
  window.addEventListener('midnight#ready', function(e) {
    var uuid = e && e.detail && e.detail.uuid;
    if (uuid && window.midnight && window.midnight[uuid]) {
      // Optionally notify UI a new wallet appeared
    }
  });

  return { connect, disconnect, onStateChange, hasWallet, hasLace: hasWallet, isConnected, isDemo, getAddress, getState };
})();
