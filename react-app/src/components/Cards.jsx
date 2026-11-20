import { ArrowUpRight, Scale, Landmark, FileCheck2, ShieldCheck, CarFront, Phone, MapPin, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

const icons = { Scale, Landmark, FileCheck2, ShieldCheck, CarFront };
export function PracticeCard({ item }) {
  const Icon = icons[item.icon] || Scale;
  return <article className="practice-card">
    <div className="card-icon"><Icon size={23} strokeWidth={1.7} /></div>
    <h3>{item.title}</h3>
    <p>{item.description}</p>
    <Link className="text-link" to={`/practice-areas/${item.slug}`}>Explore service <ArrowUpRight size={16} /></Link>
  </article>;
}
export function ContactCard({ kind, value, href, children }) {
  const Icon = kind === 'phone' ? Phone : kind === 'email' ? Mail : MapPin;
  return <a className="contact-card" href={href}>
    <span className="card-icon"><Icon size={21} /></span>
    <span><small>{children}</small><strong>{value}</strong></span>
    <ArrowUpRight size={17} />
  </a>;
}
export function ArticleCard({ post }) {
  return <article className="article-card">
    {post.featured_image ? <img src={post.featured_image} alt="" loading="lazy" /> : <div className="article-placeholder"><Scale size={30} /></div>}
    <div className="article-card__body">
      <span className="eyebrow">{post.category || 'Legal insights'}</span>
      <h3>{post.title}</h3>
      <p>{post.excerpt || ''}</p>
      <Link className="text-link" to={`/blog/${post.slug}`}>Read article <ArrowUpRight size={16} /></Link>
    </div>
  </article>;
}
