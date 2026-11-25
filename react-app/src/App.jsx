import { Routes, Route, Navigate } from 'react-router-dom';
import { Header, Footer } from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import PracticeAreas from './pages/PracticeAreas.jsx';
import About from './pages/About.jsx';
import Contact from './pages/Contact.jsx';
import Blog from './pages/Blog.jsx';

function NotFound() { return <main className="container not-found"><span className="eyebrow">Page not found</span><h1>We couldn't find that page.</h1><a className="text-link" href="#/">Return home</a></main>; }

export default function App() {
  return <><a className="skip-link" href="#main">Skip to content</a><Header/><main id="main">
    <Routes>
      <Route path="/" element={<Home/>}/>
      <Route path="/practice-areas" element={<PracticeAreas/>}/>
      <Route path="/practice-areas/:slug" element={<PracticeAreas/>}/>
      <Route path="/about" element={<About/>}/>
      <Route path="/contact" element={<Contact/>}/>
      <Route path="/blog" element={<Blog/>}/>
      <Route path="/blog/:slug" element={<Blog/>}/>
      <Route path="*" element={<NotFound/>}/>
    </Routes>
  </main><Footer/></>;
}
