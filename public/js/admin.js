/* MOVIXA admin interactions */
(function () {
  'use strict';

  /* sidebar toggle (mobile) */
  const menuBtn = document.getElementById('adminMenuBtn');
  const sidebar = document.getElementById('adminSidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  /* auto slug */
  const slugSource = document.querySelector('[data-slug-source]');
  const slugTarget = document.querySelector('[data-slug-target]');
  if (slugSource && slugTarget && !slugTarget.value) {
    slugSource.addEventListener('input', () => {
      slugTarget.value = slugSource.value.toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
    });
  }

  /* char counters */
  document.querySelectorAll('[data-count]').forEach((el) => {
    const max = parseInt(el.dataset.count, 10);
    const counter = el.parentElement.querySelector('.char-count');
    const update = () => { if (counter) counter.textContent = `${el.value.length}/${max}`; };
    el.addEventListener('input', update);
    update();
  });

  /* video source selector hints */
  const vp = document.getElementById('videoProvider');
  const vg = document.getElementById('videoInputGroup');
  const vl = document.getElementById('videoInputLabel');
  const vh = document.getElementById('videoInputHint');
  function syncVideoHint() {
    if (!vp || !vg) return;
    if (vp.value === 'dailymotion') {
      vg.style.display = '';
      if (vl) vl.textContent = 'Dailymotion Video ID or Embed URL';
      if (vh) vh.textContent = 'Paste the Video ID (e.g. x8abc12) or any Dailymotion video / embed URL.';
    } else if (vp.value === 'custom') {
      vg.style.display = '';
      if (vl) vl.textContent = 'Authorized Embed URL';
      if (vh) vh.textContent = 'Paste an https video URL from YouTube, Vimeo or Dailymotion (watch links work too).';
    } else {
      vg.style.display = 'none';
    }
  }
  if (vp) { vp.addEventListener('change', syncVideoHint); syncVideoHint(); }

  /* check all */
  const checkAll = document.getElementById('checkAll');
  if (checkAll) {
    checkAll.addEventListener('change', () => {
      document.querySelectorAll('.row-check').forEach((c) => { c.checked = checkAll.checked; });
    });
  }

  /* confirm helper for buttons with data-confirm */
  document.querySelectorAll('[data-confirm]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (!confirm(el.dataset.confirm)) e.preventDefault();
    });
  });

  /* delete via POST form */
  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('Are you sure? This cannot be undone.')) return;
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = btn.dataset.delete;
      document.body.appendChild(form);
      form.submit();
    });
  });

  /* generic POST buttons */
  document.querySelectorAll('[data-post]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = btn.dataset.post;
      document.body.appendChild(form);
      form.submit();
    });
  });

  /* copy buttons */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text.startsWith('http') ? text : location.origin + text);
        const old = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = old; }, 1500);
      } catch (e) { prompt('Copy this URL:', text); }
    });
  });

  /* settings tabs */
  const tabs = document.querySelectorAll('.settings-tab');
  if (tabs.length) {
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.settings-panel').forEach((p) => {
          p.classList.toggle('active', p.dataset.panel === tab.dataset.tab);
        });
      });
    });
  }

  /* genre drag reorder */
  const genreRows = document.getElementById('genreRows');
  if (genreRows) {
    let dragEl = null;
    genreRows.querySelectorAll('tr').forEach((row) => {
      row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); saveOrder(); });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        const after = getAfter(genreRows, e.clientY);
        if (after == null) genreRows.appendChild(dragEl);
        else genreRows.insertBefore(dragEl, after);
      });
    });
    function getAfter(container, y) {
      const rows = [...container.querySelectorAll('tr:not(.dragging)')];
      return rows.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    async function saveOrder() {
      const order = [...genreRows.querySelectorAll('tr')].map((r) => r.dataset.id);
      try {
        await fetch('/admin/genres/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order })
        });
      } catch (e) { /* ignore */ }
    }
  }
})();
