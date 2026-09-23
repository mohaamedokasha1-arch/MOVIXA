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

  /* video source selector hints (labels/hints come from the server per option) */
  const vp = document.getElementById('videoProvider');
  const vg = document.getElementById('videoInputGroup');
  const vl = document.getElementById('videoInputLabel');
  const vh = document.getElementById('videoInputHint');
  const vi = document.getElementById('videoInput');
  function syncVideoHint() {
    if (!vp || !vg) return;
    if (vp.value === 'none') { vg.style.display = 'none'; hideVideoPreview(); return; }
    const opt = vp.options[vp.selectedIndex];
    vg.style.display = '';
    if (vl && opt.dataset.label) vl.textContent = opt.dataset.label;
    if (vh) vh.textContent = opt.dataset.hint || '';
    hideVideoPreview();
  }
  if (vp) { vp.addEventListener('change', syncVideoHint); syncVideoHint(); }
  if (vi) vi.addEventListener('input', hideVideoPreview);

  /* live video preview — validated server-side, same as save */
  const vpb = document.getElementById('videoPreviewBtn');
  const vbox = document.getElementById('videoPreviewBox');
  const vframe = document.getElementById('videoPreviewFrame');
  const verr = document.getElementById('videoPreviewError');
  const vurl = document.getElementById('videoPreviewUrl');
  function hideVideoPreview() {
    if (!vbox) return;
    vbox.hidden = true;
    if (vframe) vframe.innerHTML = '';
    if (verr) verr.hidden = true;
    if (vurl) vurl.textContent = '';
  }
  if (vpb && vp && vi) {
    vpb.addEventListener('click', async () => {
      hideVideoPreview();
      vpb.disabled = true;
      vpb.textContent = 'Checking...';
      try {
        const res = await fetch('/admin/api/video-preview?provider=' + encodeURIComponent(vp.value) + '&input=' + encodeURIComponent(vi.value.trim()));
        const data = await res.json();
        vbox.hidden = false;
        if (data.ok && data.embedUrl) {
          const frame = document.createElement('iframe');
          frame.src = data.embedUrl;
          frame.title = 'Video preview';
          frame.setAttribute('frameborder', '0');
          frame.setAttribute('allowfullscreen', '');
          frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
          vframe.appendChild(frame);
          vurl.textContent = data.embedUrl;
        } else if (data.ok) {
          verr.textContent = 'No embedded player — only the external watch link will be shown.';
          verr.hidden = false;
        } else {
          verr.textContent = data.error || 'Invalid video source.';
          verr.hidden = false;
        }
      } catch (e) {
        vbox.hidden = false;
        verr.textContent = 'Preview failed. Check your connection and try again.';
        verr.hidden = false;
      } finally {
        vpb.disabled = false;
        vpb.textContent = 'Preview';
      }
    });
  }

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
