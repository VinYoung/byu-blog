(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === '1') {
      document.documentElement.classList.add('is-embed');
      document.body.classList.add('is-embed');

      let lastPostedHeight = 0;
      let rafId = 0;

      const postHeight = () => {
        try {
          const rawHeight = Math.max(
            document.documentElement?.scrollHeight || 0,
            document.body?.scrollHeight || 0,
            document.documentElement?.offsetHeight || 0,
            document.body?.offsetHeight || 0
          );
          const height = Math.min(Math.max(0, rawHeight), 12000);
          if (!height || !window.parent || window.parent === window) return;
          if (Math.abs(height - lastPostedHeight) < 2) return;
          lastPostedHeight = height;
          window.parent.postMessage({ type: 'BYU_HEXO_HEIGHT', height }, '*');
        } catch {
          // ignore
        }
      };

      const schedulePostHeight = () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          postHeight();
        });
      };

      const ensureEmbedParam = (href) => {
        if (!href) return null;
        const trimmed = href.trim();
        if (
          trimmed.startsWith('#') ||
          trimmed.startsWith('mailto:') ||
          trimmed.startsWith('tel:') ||
          trimmed.startsWith('javascript:')
        ) {
          return null;
        }

        try {
          const u = new URL(trimmed, window.location.href);
          if (u.origin !== window.location.origin) return null;
          u.searchParams.set('embed', '1');
          return u.pathname + u.search + u.hash;
        } catch {
          return null;
        }
      };

      const patchLinks = () => {
        document.querySelectorAll('a[href]').forEach((a) => {
          const next = ensureEmbedParam(a.getAttribute('href'));
          if (next && a.getAttribute('href') !== next) a.setAttribute('href', next);
        });
      };

      patchLinks();
      schedulePostHeight();

      const obs = new MutationObserver(() => {
        patchLinks();
        schedulePostHeight();
      });
      obs.observe(document.body, { childList: true, subtree: true });

      window.addEventListener('load', () => schedulePostHeight(), { once: true });
      window.addEventListener('resize', () => schedulePostHeight());
      // Give images/fonts a moment to settle
      setTimeout(() => schedulePostHeight(), 300);
      setTimeout(() => schedulePostHeight(), 1200);
    }
  } catch {
    // ignore
  }
})();
