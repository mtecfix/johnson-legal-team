// Renders Decap-managed blog content on the public static site.
// List view reads content/blog/index.json (a manifest, since static hosting
// cannot list a directory). Single-post view fetches the markdown file and
// strips its YAML front matter before rendering with marked.

const BLOG_DIR = 'content/blog';

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('post');
  if (slug) {
    renderSinglePost(slug);
  } else {
    renderList();
  }
});

async function renderList() {
  const listEl = document.getElementById('postList');
  try {
    const res = await fetch(`${BLOG_DIR}/index.json`);
    if (!res.ok) throw new Error(`Manifest error ${res.status}`);
    const { posts } = await res.json();
    if (!posts || !posts.length) {
      listEl.innerHTML = '<p class="text-muted">No posts yet.</p>';
      return;
    }
    listEl.innerHTML = posts.map(p => `
      <div class="col-md-6 col-lg-4">
        <div class="card h-100 shadow-sm">
          ${p.featured_image ? `<img src="${escapeAttr(p.featured_image)}" class="card-img-top" style="height:180px;object-fit:cover;" alt="">` : ''}
          <div class="card-body d-flex flex-column">
            <span class="badge bg-primary align-self-start mb-2">${escapeHtml(p.category || 'News')}</span>
            <h5 class="card-title">${escapeHtml(p.title)}</h5>
            <p class="card-text text-muted small">${escapeHtml(p.excerpt || '')}</p>
            <div class="mt-auto d-flex justify-content-between align-items-center">
              <small class="text-muted">${escapeHtml(p.publish_date || '')}</small>
              <a href="blog.html?post=${encodeURIComponent(p.slug)}" class="btn btn-sm btn-primary">Read</a>
            </div>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error(err);
    listEl.innerHTML = '<p class="text-danger">Could not load posts.</p>';
  }
}

async function renderSinglePost(slug) {
  document.getElementById('postList').style.display = 'none';
  const view = document.getElementById('postView');
  view.style.display = 'block';
  try {
    // Guard the slug so it can only reference a markdown file in the blog dir.
    const safeSlug = slug.replace(/[^a-z0-9\-]/gi, '');
    const res = await fetch(`${BLOG_DIR}/${safeSlug}.md`);
    if (!res.ok) throw new Error(`Post error ${res.status}`);
    const raw = await res.text();
    const { data, body } = parseFrontMatter(raw);

    document.getElementById('postTitle').textContent = data.title || 'Untitled';
    document.getElementById('postCategory').textContent = data.category || 'News';
    document.getElementById('postDate').textContent = formatDate(data.publish_date);
    const img = document.getElementById('postImage');
    if (data.featured_image) { img.src = data.featured_image; img.alt = data.title || ''; }
    else { img.style.display = 'none'; }
    // marked handles escaping of the markdown body content.
    document.getElementById('postBody').innerHTML = marked.parse(body);
  } catch (err) {
    console.error(err);
    view.innerHTML = '<p class="text-danger">Post not found.</p><a href="blog.html">Back to blog</a>';
  }
}

// Minimal YAML front-matter parser (handles the flat scalar keys we emit).
function parseFrontMatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const data = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !key.startsWith('-')) data[key] = val;
  });
  return { data, body: match[2] };
}

function formatDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
