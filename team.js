// Renders the Team collection managed by Decap CMS.
const TEAM_DIR = 'content/team';

document.addEventListener('DOMContentLoaded', async () => {
  const el = document.getElementById('teamList');
  try {
    const { members } = await CMSContent.fetchManifest(TEAM_DIR);
    if (!members || !members.length) {
      el.innerHTML = '<p class="text-muted">No team members yet.</p>';
      return;
    }
    const sorted = members.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    // Load each member's full bio (markdown body) in parallel.
    const cards = await Promise.all(sorted.map(async m => {
      let bioHtml = '';
      try {
        const { body } = await CMSContent.fetchEntry(TEAM_DIR, m.slug);
        bioHtml = marked.parse(body);
      } catch { bioHtml = '<p class="text-muted">Bio coming soon.</p>'; }
      const esc = CMSContent.escapeHtml;
      return `
        <div class="col-md-6 col-lg-4">
          <div class="card h-100 shadow-sm">
            ${m.photo ? `<img src="${esc(m.photo)}" class="card-img-top" style="height:260px;object-fit:cover;" alt="${esc(m.name)}">` : ''}
            <div class="card-body">
              <h5 class="card-title mb-0">${esc(m.name)}</h5>
              <p class="text-muted">${esc(m.role || '')}</p>
              <div class="small">${bioHtml}</div>
            </div>
          </div>
        </div>`;
    }));
    el.innerHTML = cards.join('');
  } catch (err) {
    console.error(err);
    el.innerHTML = '<p class="text-danger">Could not load team.</p>';
  }
});
