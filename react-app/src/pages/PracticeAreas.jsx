import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { PageIntro } from '../components/Layout.jsx';
import { Button } from '../components/Button.jsx';
import { PracticeCard } from '../components/Cards.jsx';
import { practiceAreas } from '../data/site.js';

export default function PracticeAreas() {
  const { slug } = useParams();
  const selected = practiceAreas.find(item => item.slug === slug);
  const [expanded, setExpanded] = useState('');
  if (slug) return <><PageIntro eyebrow="Practice area" title={selected?.title || 'Service information'} text={selected?.description || 'Contact Johnson Legal Team to discuss whether the firm can assist with your matter.'}/><section className="section container narrow"><h2>Discuss your circumstances</h2><p>Every legal matter depends on its facts, deadlines, and applicable law. Contact the firm to discuss your situation and determine the appropriate next step.</p><Button to="/contact">Request a consultation <ArrowRight size={16}/></Button></section></>;
  return <>
    <section className="section practice-section">
      <div className="container">
        <div className="section-heading"><div><span className="eyebrow">What we do</span><h2>Our Practice Areas</h2></div></div>
        <div className="practice-grid">{practiceAreas.map(item => <PracticeCard key={item.slug} item={item}/>)}</div>
      </div>
    </section>
    <section className="section section--soft"><div className="container narrow"><span className="eyebrow">Frequently asked questions</span><h2>Starting with the right questions.</h2>
      {['What should I bring to an initial consultation?','How do I know which practice area applies to my situation?','Does submitting a website inquiry create an attorney-client relationship?'].map((q,i)=><div className="faq-item" key={q}><button aria-expanded={expanded===String(i)} onClick={()=>setExpanded(expanded===String(i)?'':String(i))}>{q}<ChevronDown className={expanded===String(i)?'rotate':''}/></button>{expanded===String(i)&&<p>{i===2?'No. A website inquiry does not create an attorney-client relationship. Representation begins only after the firm agrees to represent you and the appropriate engagement documentation is completed.':'Contact the office before your meeting. The team can advise which documents or information will be useful for an initial discussion.'}</p>}</div>)}
      <Button to="/contact" variant="secondary">Ask the firm a question <ArrowRight size={16}/></Button>
    </div></section>
  </>;
}
