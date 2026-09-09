(() => {
  'use strict';

  const GOOGLE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v7.4h12.6c-.3 2.1-1.6 5.2-4.7 7.3l7.2 5.6c4.3-4 6.9-9.9 6.9-16.2z"/><path fill="#FBBC05" d="M10.5 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.9-6.1C1 15.6 0 19.7 0 24s1 8.4 2.6 11.4l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.4-8.7 2.4-6.3 0-11.7-3.7-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

  function returnPath(element) {
    const explicit = element.dataset.returnTo;
    if (explicit && explicit.startsWith('/') && !explicit.startsWith('//') && !/[\\\r\n]/.test(explicit)) return explicit;
    return `${location.pathname}${location.search}`;
  }

  async function mount() {
    const containers = [...document.querySelectorAll('[data-student-google]')];
    if (!containers.length) return;
    try {
      const response = await fetch('/api/student/auth/providers');
      const data = await response.json();
      if (!response.ok || !(data.providers || []).some(provider => provider.id === 'google')) return;
      for (const container of containers) {
        const next = encodeURIComponent(returnPath(container));
        container.innerHTML = `<div class="student-social-divider"><span>or</span></div><a class="student-google-button" href="/auth/google?student=1&next=${next}">${GOOGLE_ICON}<span>Continue with Google</span></a><p class="student-social-note">Use your school Google account.</p>`;
        container.hidden = false;
      }
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
