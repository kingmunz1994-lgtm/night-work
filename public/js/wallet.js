// Night ecosystem wallet connector — shared across all Night apps
// Supports Midnight Lace extension, Nocturne, and demo mode fallback

var nightWallet = (function () {
  var _state = { connected: false, demo: false, address: null, night: 0, dust: 0, api: null };
  var _listeners = [];

  function _notify() { _listeners.forEach(fn => { try { fn({ ..._state }); } catch (e) {} }); }

  function onStateChange(fn) { _listeners.push(fn); }

  function hasLace() { return !!(window.midnight && (window.midnight.mnLace || window.midnight.mnNocturne)); }

  async function connectLace() {
    const m = window.midnight;
    if (!m) throw new Error('Midnight wallet not found — install Lace or Nocturne.');
    const connector = m.mnLace || m.mnNocturne;
    if (!connector) throw new Error('No Midnight connector found in window.midnight.');
    const api = await connector.enable();
    let address = 'midnight1unknown';
    let night = 0, dust = 0;
    try {
      const state = await api.state?.();
      address = state?.address ?? state?.coinPublicKey ?? address;
      const bals = state?.balances ?? {};
      night = Number(bals.night ?? bals.NIGHT ?? 0);
      dust  = Number(bals.dust  ?? bals.DUST  ?? 0);
    } catch { /* wallet may not expose balance pre-connection */ }
    _state = { connected: true, demo: false, address, night, dust, api };
    _notify();
    return { ..._state };
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
    _state = { connected: false, demo: false, address: null, night: 0, dust: 0, api: null };
    _notify();
  }

  function getState()    { return { ..._state }; }
  function isConnected() { return _state.connected; }
  function isDemo()      { return _state.demo; }
  function getAddress()  { return _state.address; }

  return { connect, disconnect, onStateChange, hasLace, isConnected, isDemo, getAddress, getState };
})();
