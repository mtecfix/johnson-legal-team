import { useState } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { PageIntro } from '../components/Layout.jsx';
import { Button } from '../components/Button.jsx';
import { PracticeCard } from '../components/Cards.jsx';
import { practiceAreas } from '../data/site.js';

export default function PracticeAreas() {
  const [expanded, setExpanded] = useState('');
  return <><PageIntro eyebrow="Our services" title="Practice areas" text="Explore the legal matters handled by Johnson Legal Team. Contact the firm to discuss your circumstances and available options."/>
    <section className="section container"><div className="practice-grid">{practiceAreas.map(item => <PracticeCard key={item.slug} item={item}/>)}</div></section>
    <section className="section section--soft"><div className="container narrow"><span className="eyebrow">Frequently asked questions</span><h2>Starting with the right questions.</h2>
      {['What should I bring to an initial consultation?','How do I know which practice area applies to my situation?','Does submitting a website inquiry create an attorney-client relationship?'].map((q,i)=><div className="faq-item" key={q}><button aria-expanded={expanded===String(i)} onClick={()=>setExpanded(expanded===String(i)?'':String(i))}>{q}<ChevronDown className={expanded===String(i)?'rotate':''}/></button>{expanded===String(i)&&<p>{i===2?'No. A website inquiry does not create an attorney-client relationship. Representation begins only after the firm agrees to represent you and the appropriate engagement documentation is completed.':'Contact the office before your meeting. The team can advise which documents or information will be useful for an initial discussion.'}</p>}</div>)}
      <Button to="/contact" variant="secondary">Ask the firm a question <ArrowRight size={16}/></Button>
    </div></section>
  </>;
}
