// Renders Decap-managed blog content on the public static site.
// List view reads content/blog/index.json (a manifest, since static hosting
// cannot list a directory). Single-post view fetches the markdown file.
const BLOG_DIR = 'content/blog';

document.addEventListener('DOMContentLoaded', () => {
  const slug = new URLSearchParams(window.location.search).get('post');
  slug ? renderSinglePost(slug) : renderList();
});

async function renderList() {
  const listEl = document.getElementById('postList');
  try {
    const { posts } = await CMSContent.fetchManifest(BLOG_DIR);
    if (!posts || !posts.length) { listEl.innerHTML = '<p class="text-muted">No posts yet.</p>'; return; }
    const esc = CMSContent.escapeHtml;
    listEl.innerHTML = posts.map(p => `
      <div class="col-md-6 col-lg-4">
        <div class="card h-100 shadow-sm">
          ${p.featured_image ? `<img src="${esc(p.featured_image)}" class="card-img-top" style="height:180px;object-fit:cover;" alt="">` : ''}
          <div class="card-body d-flex flex-column">
            <span class="badge bg-primary align-self-start mb-2">${esc(p.category || 'News')}</span>
            <h5 class="card-title">${esc(p.title)}</h5>
            <p class="card-text text-muted small">${esc(p.excerpt || '')}</p>
            <div class="mt-auto d-flex justify-content-between align-items-center">
              <small class="text-muted">${esc(p.publish_date || '')}</small>
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
    const { data, body } = await CMSContent.fetchEntry(BLOG_DIR, slug);
    document.getElementById('postTitle').textContent = data.title || 'Untitled';
    document.getElementById('postCategory').textContent = data.category || 'News';
    document.getElementById('postDate').textContent = CMSContent.formatDate(data.publish_date);
    const img = document.getElementById('postImage');
    if (data.featured_image) { img.src = data.featured_image; img.alt = data.title || ''; }
    else { img.style.display = 'none'; }
    document.getElementById('postBody').innerHTML = marked.parse(body);
  } catch (err) {
    console.error(err);
    view.innerHTML = '<p class="text-danger">Post not found.</p><a href="blog.html">Back to blog</a>';
  }
}
