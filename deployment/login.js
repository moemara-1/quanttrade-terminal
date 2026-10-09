'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const form = document.getElementById('login-form');
  const error = document.getElementById('login-error');
  const submitButton = document.getElementById('submit-button');
  const sessionControls = document.getElementById('session-controls');
  const logoutButton = document.getElementById('logout-button');
  let pending = false;

  function destination(value) {
    if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/futures';
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname === '/login' || url.pathname.startsWith('/_quanttrade/')) return '/futures';
      return url.pathname + url.search + url.hash;
    } catch {
      return '/futures';
    }
  }

  const next = destination(query.get('next'));
  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }
  function setPending(value) {
    pending = value;
    submitButton.disabled = value;
    logoutButton.disabled = value;
    form.setAttribute('aria-busy', String(value));
    submitButton.textContent = value ? 'Signing in…' : 'Open QuantTrade →';
  }
  async function request(path, options = {}) {
    return fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  }
  async function logout() {
    if (pending) return;
    setPending(true);
    error.hidden = true;
    try {
      const response = await request('/_quanttrade/api/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('logout');
      window.location.replace('/login?next=' + encodeURIComponent(next));
    } catch {
      form.hidden = false;
      showError('Could not sign out. Please try again.');
      setPending(false);
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    error.hidden = true;
    setPending(true);
    try {
      const response = await request('/_quanttrade/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.elements.username.value.trim(), password: form.elements.password.value, remember: form.elements.remember.checked }),
      });
      if (!response.ok) {
        showError(response.status === 429 ? 'Too many sign-in attempts. Please wait and try again.' : 'Could not sign in. Check your username and password and try again.');
        return;
      }
      form.elements.password.value = '';
      window.location.replace(next);
    } catch {
      showError('Could not reach QuantTrade. Please try again.');
    } finally {
      setPending(false);
    }
  });
  logoutButton.addEventListener('click', logout);
  document.getElementById('continue-button').addEventListener('click', () => window.location.replace(next));
  async function checkSession() {
    if (query.has('logout')) {
      form.hidden = true;
      sessionControls.hidden = false;
      document.getElementById('login-intro').textContent = 'Manage your sign-in on this device.';
      await logout();
      return;
    }
    try {
      const response = await request('/_quanttrade/api/session');
      if (!response.ok) return;
      const session = await response.json();
      if (session.ok !== true) return;
      if (query.has('manage')) {
        form.hidden = true;
        sessionControls.hidden = false;
        document.getElementById('login-intro').textContent = 'Manage your sign-in on this device.';
      } else {
        window.location.replace(next);
      }
    } catch {
      // Keep the sign-in form available when the session check cannot complete.
    }
  }
  void checkSession();
})();
