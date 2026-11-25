import { ArrowUpRight, Scale, Landmark, FileCheck2, ShieldCheck, CarFront, Phone, MapPin, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

const icons = { Scale, Landmark, FileCheck2, ShieldCheck, CarFront };
export function PracticeCard({ item }) {
  const Icon = icons[item.icon] || Scale;
  return <Link className="practice-card" to={`/practice-areas/${item.slug}`} aria-label={`Learn about ${item.title}`}>
    <span className="card-icon" aria-hidden="true"><Icon size={38} strokeWidth={1.35} /></span>
    <span className="practice-card__content">
      <span className="practice-card__title">{item.title}</span>
      <span className="practice-card__description">{item.description}</span>
    </span>
    <ArrowUpRight className="practice-card__arrow" size={17} aria-hidden="true" />
  </Link>;
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
