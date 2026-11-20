import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Scale } from 'lucide-react';
import { PageIntro } from '../components/Layout.jsx';

const CONTENT_BASE = new URL('../content/blog/', window.location.href).toString();
function parseFrontMatter(raw) {
  const m=raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/); if(!m)return {data:{},body:raw};
  const data={}; m[1].split('\n').forEach(line=>{const i=line.indexOf(':');if(i>0)data[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^["']|["']$/g,'');});
  return {data,body:m[2]};
}
export default function Blog() {
  const {slug}=useParams(); const [posts,setPosts]=useState([]); const [selected,setSelected]=useState(null); const [error,setError]=useState('');
  useEffect(()=>{let active=true;fetch(new URL('index.json',CONTENT_BASE)).then(r=>{if(!r.ok)throw new Error('Blog manifest unavailable');return r.json();}).then(d=>{if(active)setPosts((d.posts||[]).sort((a,b)=>(b.publish_date||'').localeCompare(a.publish_date||'')));}).catch(()=>{if(active)setError('Legal articles are temporarily unavailable. Please check back soon.');});return()=>{active=false};},[]);
  useEffect(()=>{if(!slug)return;let active=true;fetch(new URL(`${encodeURIComponent(slug)}.md`,CONTENT_BASE)).then(r=>{if(!r.ok)throw new Error('Article unavailable');return r.text();}).then(t=>{if(active)setSelected(parseFrontMatter(t));}).catch(()=>{if(active)setError('This article could not be found.');});return()=>{active=false};},[slug]);
  if(slug) return <><PageIntro eyebrow="Legal insights" title={selected?.data?.title||'Article'}/><article className="container article-detail"><Link to="/blog" className="text-link"><ArrowLeft size={16}/> Back to articles</Link>{selected?.data?.featured_image&&<img className="article-detail__image" src={selected.data.featured_image} alt=""/>}<div className="article-copy">{(selected?.body||'').split(/\n\s*\n/).filter(Boolean).map((p,i)=><p key={i}>{p.replace(/^#+\s*/gm,'').replace(/[*_]/g,'')}</p>)}</div></article></>;
  return <><PageIntro eyebrow="Knowledge & updates" title="Legal insights" text="Practical information and updates from Johnson Legal Team."/><section className="section container"><div className="article-grid">{posts.map(p=><article className="article-card" key={p.slug}>{p.featured_image?<img src={p.featured_image} alt="" loading="lazy"/>:<div className="article-placeholder"><Scale/></div>}<div className="article-card__body"><span className="eyebrow">{p.category||'Legal insights'}</span><h3>{p.title}</h3><p>{p.excerpt||''}</p><Link className="text-link" to={`/blog/${p.slug}`}>Read article <ArrowUpRight size={16}/></Link></div></article>)}</div>{error&&<p className="empty-state">{error}</p>}{!posts.length&&!error&&<p className="empty-state">Loading legal insights…</p>}</section></>;
}
