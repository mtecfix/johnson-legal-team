import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X, Phone, ArrowUpRight } from 'lucide-react';
import { firm } from '../data/site.js';

export function Header() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <header className="site-header">
    <div className="nav-shell">
      <Link to="/" className="brand" onClick={close} aria-label="Johnson Legal Team home">
        <img src="../images/logo-cropped.png" alt="Johnson Legal Team" />
      </Link>
      <button className="menu-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      <nav className={open ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation">
        <NavLink to="/practice-areas" onClick={close}>Practice Areas</NavLink>
        <NavLink to="/about" onClick={close}>About</NavLink>
        <NavLink to="/blog" onClick={close}>Legal Insights</NavLink>
        <NavLink to="/contact" onClick={close}>Contact</NavLink>
        <a className="nav-login" href="../client-login.html">Client Login <ArrowUpRight size={14}/></a>
      </nav>
      <a className="nav-call" href={firm.phoneHref}><Phone size={16}/><span>{firm.phone}</span></a>
    </div>
  </header>;
}

export function Footer() {
  return <footer className="site-footer">
    <div className="footer-grid">
      <div><Link to="/" className="footer-brand">JOHNSON <span>LEGAL TEAM</span></Link><p>Dedicated legal representation for Michigan families and businesses.</p></div>
      <div><h3>Explore</h3><Link to="/practice-areas">Practice Areas</Link><Link to="/about">About the Firm</Link><Link to="/blog">Legal Insights</Link><Link to="/contact">Contact</Link></div>
      <div><h3>Contact</h3><a href={firm.phoneHref}>{firm.phone}</a><a href={`mailto:${firm.email}`}>{firm.email}</a><p>{firm.address}</p></div>
    </div>
    <div className="footer-bottom"><span>© {new Date().getFullYear()} Johnson Legal Team. All rights reserved.</span><span>No attorney-client relationship is created by use of this website.</span></div>
  </footer>;
}

export function PageIntro({ eyebrow, title, text }) {
  return <section className="page-intro"><div className="container"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{text && <p>{text}</p>}</div></section>;
}
