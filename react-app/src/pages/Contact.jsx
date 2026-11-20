import { useState } from 'react';
import { ArrowRight, Clock3, MapPin, Phone, Mail } from 'lucide-react';
import { PageIntro } from '../components/Layout.jsx';
import { firm } from '../data/site.js';

const API = 'https://mpiai89295.execute-api.us-east-1.amazonaws.com/leads';
const CASE_TYPES = {
  'Personal Injury': 'personal-injury',
  'Estate Planning & Probate': 'probate-estate-planning',
  'Expungements': 'expungements',
  'Misdemeanor Defense': 'misdemeanors',
  'Traffic Tickets': 'traffic-tickets',
  'Other': 'general'
};

export default function Contact() {
  const [challenge] = useState(() => { const a=Math.floor(Math.random()*10)+1,b=Math.floor(Math.random()*10)+1; return {a,b,answer:a+b}; });
  const [form,setForm] = useState({firstName:'',lastName:'',email:'',phone:'',caseType:'Other',urgency:'',message:'',captcha:'',consent:false});
  const [status,setStatus] = useState({kind:'',message:''});
  const [busy,setBusy] = useState(false);
  const change = e => setForm(v=>({...v,[e.target.name]:e.target.type==='checkbox'?e.target.checked:e.target.value}));
  async function submit(e) {
    e.preventDefault();
    if (Number(form.captcha)!==challenge.answer) { setStatus({kind:'error',message:'The security answer is incorrect. Please try again.'}); return; }
    if (!form.consent) { setStatus({kind:'error',message:'Please provide consent before submitting.'}); return; }
    setBusy(true); setStatus({kind:'info',message:'Sending your message…'});
    const body = [form.message,form.phone?`Phone: ${form.phone}`:null,form.urgency?`Urgency: ${form.urgency}`:null,form.caseType?`Case Type: ${form.caseType}`:null].filter(Boolean).join('\n\n');
    try {
      const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:form.email,subject:`Website inquiry from ${form.firstName} ${form.lastName}`,body,source:'contact-form'})});
      if(!res.ok) throw new Error(`Server responded ${res.status}`);
      await res.json();
      setStatus({kind:'success',message:'Thank you. Your message has been received. Please do not send confidential or time-sensitive information through this form.'});
      setForm({firstName:'',lastName:'',email:'',phone:'',caseType:'Other',urgency:'',message:'',captcha:'',consent:false});
    } catch { setStatus({kind:'error',message:`We could not send your message. Please call ${firm.phone} or try again later.`}); }
    finally { setBusy(false); }
  }
  return <><PageIntro eyebrow="Get in touch" title="Let's discuss your legal needs." text="Reach out to the office to request an initial conversation. Please do not include confidential or time-sensitive information in this form."/>
    <section className="section container contact-layout"><aside className="contact-details">
      <div className="contact-detail"><Phone/><div><small>Call the office</small><a href={firm.phoneHref}>{firm.phone}</a></div></div>
      <div className="contact-detail"><Mail/><div><small>Email</small><a href={`mailto:${firm.email}`}>{firm.email}</a></div></div>
      <div className="contact-detail"><MapPin/><div><small>Office</small><span>{firm.address}</span></div></div>
      <div className="contact-detail"><Clock3/><div><small>Office hours</small>{firm.hours.map(h=><span key={h}>{h}</span>)}</div></div>
    </aside>
    <form className="contact-form" onSubmit={submit}>
      <h2>Send an inquiry</h2>
      {status.message&&<div className={`form-status form-status--${status.kind}`} role="status">{status.message}</div>}
      <div className="form-grid">
        <label>First name<input name="firstName" required value={form.firstName} onChange={change} autoComplete="given-name"/></label>
        <label>Last name<input name="lastName" required value={form.lastName} onChange={change} autoComplete="family-name"/></label>
        <label>Email<input name="email" type="email" required value={form.email} onChange={change} autoComplete="email"/></label>
        <label>Phone <span className="optional">(optional)</span><input name="phone" type="tel" value={form.phone} onChange={change} autoComplete="tel"/></label>
        <label>Practice area<select name="caseType" value={form.caseType} onChange={change}>{Object.keys(CASE_TYPES).map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Timing<select name="urgency" value={form.urgency} onChange={change}><option value="">Select timing</option><option>As soon as possible</option><option>Within a week</option><option>General inquiry</option></select></label>
        <label className="full">How can we help?<textarea name="message" rows="5" required value={form.message} onChange={change}/></label>
        <label className="full captcha-label">Security check: {challenge.a} + {challenge.b} = <input name="captcha" inputMode="numeric" required value={form.captcha} onChange={change}/></label>
        <label className="consent full"><input type="checkbox" name="consent" checked={form.consent} onChange={change}/> I understand that submitting this form does not create an attorney-client relationship and I should not include confidential information.</label>
      </div>
      <button className="button button--primary" disabled={busy}>{busy?'Sending…':'Send inquiry'} <ArrowRight size={17}/></button>
      <p className="form-note">Do not use this form for emergencies, court deadlines, or confidential case details.</p>
    </form></section>
  </>;
}
