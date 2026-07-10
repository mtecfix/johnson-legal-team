// Renders Decap-managed blog content on the public static site.
// List view reads content/blog/index.json (a manifest). Single-post view fetches markdown.
const BLOG_DIR = 'content/blog';

document.addEventListener('DOMContentLoaded', () => {
  const slug = new URLSearchParams(window.location.search).get('post');
  slug ? renderSinglePost(slug) : renderList();
});

async function renderList() {
  const listEl = document.getElementById('postList');
  try {
    const { posts } = await CMSContent.fetchManifest(BLOG_DIR);
    if (!posts || !posts.length) {
      listEl.innerHTML = `
        <div class="col-12 empty-state">
          <i class="fas fa-newspaper"></i>
          <h3>Coming Soon</h3>
          <p class="text-muted">We're working on helpful legal articles for you. Check back soon!</p>
        </div>`;
      return;
    }
    const esc = CMSContent.escapeHtml;
    listEl.innerHTML = posts.map(p => `
      <div class="col-md-6 col-lg-4">
        <div class="blog-card card">
          ${p.featured_image ? `<img src="${esc(p.featured_image)}" class="card-img-top" alt="${esc(p.title)}">` : `<div class="card-img-top" style="height:200px;background:linear-gradient(135deg, var(--accent-primary), #2c5282);display:flex;align-items:center;justify-content:center;"><i class="fas fa-balance-scale fa-3x" style="color:var(--accent-secondary);opacity:0.5;"></i></div>`}
          <div class="card-body">
            <span class="badge mb-2">${esc(p.category || 'News')}</span>
            <h5 class="card-title"><a href="blog.html?post=${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h5>
            <p class="card-text">${esc(p.excerpt || '')}</p>
            <div class="mt-auto d-flex justify-content-between align-items-center">
              <span class="meta"><i class="fas fa-calendar-alt"></i> ${CMSContent.formatDate(p.publish_date)}</span>
              <a href="blog.html?post=${encodeURIComponent(p.slug)}" class="read-more">Read More <i class="fas fa-arrow-right"></i></a>
            </div>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error(err);
    listEl.innerHTML = '<div class="col-12"><p class="text-danger">Could not load posts. Please try again later.</p></div>';
  }
}

async function renderSinglePost(slug) {
  // Hide list, hero; show single post
  document.getElementById('postList').style.display = 'none';
  document.getElementById('blogHero').style.display = 'none';
  const view = document.getElementById('postView');
  view.style.display = 'block';

  try {
    const { data, body } = await CMSContent.fetchEntry(BLOG_DIR, slug);
    document.title = `${data.title || 'Blog Post'} | Johnson Legal Team`;
    document.getElementById('postTitle').textContent = data.title || 'Untitled';
    document.getElementById('postCategory').textContent = data.category || 'News';
    document.getElementById('postDate').textContent = CMSContent.formatDate(data.publish_date);

    const img = document.getElementById('postImage');
    if (data.featured_image) {
      img.src = data.featured_image;
      img.alt = data.title || '';
    } else {
      img.style.display = 'none';
    }

    document.getElementById('postBody').innerHTML = marked.parse(body);
  } catch (err) {
    console.error(err);
    view.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-circle"></i>
        <h3>Post Not Found</h3>
        <p class="text-muted">Sorry, we couldn't find that article.</p>
        <a href="blog.html" class="back-link"><i class="fas fa-arrow-left"></i> Back to Blog</a>
      </div>`;
  }
}
