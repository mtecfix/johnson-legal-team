import { PageIntro } from '../components/Layout.jsx';
import { Button } from '../components/Button.jsx';

export default function About() {
  return <><PageIntro eyebrow="About the firm" title="A legal team focused on people." text="Meet Johnson Legal Team and learn about the firm's approach to serving Michigan clients."/>
    <section className="section container about-layout"><div className="about-photo"><img src="../images/attorney-rodney-johnson.png" alt="Attorney Rodney M. Johnson" /></div><div><span className="eyebrow">Attorney profile</span><h2>Rodney M. Johnson</h2><p>Johnson Legal Team provides legal representation and guidance for individuals and families navigating important legal matters in Michigan.</p><p>The firm's approach emphasizes preparation, clear communication, and helping clients understand the decisions before them.</p><Button to="/contact">Contact the firm</Button></div></section>
  </>;
}
