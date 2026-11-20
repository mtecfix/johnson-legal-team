import { ArrowRight, BadgeCheck, BriefcaseBusiness, Clock3, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button.jsx';
import { PracticeCard } from '../components/Cards.jsx';
import { practiceAreas, firm } from '../data/site.js';

export default function Home() {
  return <>
    <section className="hero">
      <div className="hero__backdrop" />
      <div className="container hero__content">
        <div className="hero__copy">
          <span className="eyebrow eyebrow--light">Michigan legal representation</span>
          <h1>Experienced counsel.<br/><em>Clear direction.</em></h1>
          <p>Legal guidance for the matters that shape your family, your future, and your peace of mind.</p>
          <div className="hero__actions"><Button to="/contact" size="lg">Request a Consultation <ArrowRight size={17}/></Button><Button href={firm.phoneHref} variant="light-outline" size="lg">Call {firm.phone}</Button></div>
          <div className="hero__trust"><span><BadgeCheck size={17}/> Client-focused representation</span><span><Clock3 size={17}/> Responsive communication</span></div>
        </div>
        <div className="hero__portrait"><img src="../images/attorney-rodney-johnson.png" alt="Attorney Rodney M. Johnson" /></div>
      </div>
    </section>
    <section className="courtroom-banner" aria-label="Attorney advocacy in court">
      <div className="courtroom-banner__shade" />
      <div className="container courtroom-banner__content"><span className="eyebrow eyebrow--light">Prepared to advocate</span><h2>Focused advocacy. Thoughtful counsel.</h2><p>Committed to helping clients understand their options and move forward with confidence.</p></div>
    </section>
    <section className="section container">
      <div className="section-heading"><div><span className="eyebrow">How we can help</span><h2>Legal services centered on what matters.</h2></div><Link className="text-link" to="/practice-areas">View all practice areas <ArrowRight size={16}/></Link></div>
      <div className="practice-grid">{practiceAreas.map(item => <PracticeCard key={item.slug} item={item}/>)}</div>
    </section>
    <section className="split-section"><div className="container split-section__inner"><div className="split-section__image"><img src="../images/attorney-rodney-johnson.png" alt="Attorney Rodney M. Johnson" /></div><div><span className="eyebrow">Meet your legal team</span><h2>Personal attention. Professional advocacy.</h2><p>Johnson Legal Team works with Michigan clients on important legal matters with an emphasis on communication, preparation, and practical guidance.</p><Button to="/about" variant="secondary">Meet the firm <ArrowRight size={16}/></Button></div></div></section>
    <section className="cta-band"><div className="container cta-band__inner"><div><span className="eyebrow eyebrow--light">Start a conversation</span><h2>Understand your options before you decide your next step.</h2></div><Button to="/contact" variant="bronze" size="lg">Contact the firm <ArrowRight size={17}/></Button></div></section>
  </>;
}
