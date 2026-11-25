import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('App.jsx');
const contact = read('pages/Contact.jsx');
const blog = read('pages/Blog.jsx');
const layout = read('components/Layout.jsx');

const requiredRoutes = [
  'path="/"',
  'path="/practice-areas"',
  'path="/practice-areas/:slug"',
  'path="/about"',
  'path="/contact"',
  'path="/blog"',
  'path="/blog/:slug"'
];
const missingRoutes = requiredRoutes.filter(route => !app.includes(route));
const requiredFiles = [
  'main.jsx', 'App.jsx', 'components/Button.jsx', 'components/Cards.jsx',
  'components/Layout.jsx', 'pages/Home.jsx', 'pages/PracticeAreas.jsx',
  'pages/About.jsx', 'pages/Contact.jsx', 'pages/Blog.jsx',
  'styles/tokens.css', 'styles/global.css'
];
const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.join(root, file)));

const integrationChecks = [
  ['contact endpoint', contact.includes('https://mpiai89295.execute-api.us-east-1.amazonaws.com/leads')],
  ['contact payload contract', ['from:', 'subject:', 'body,', "source:'contact-form'"].every(value => contact.includes(value))],
  ['CMS blog manifest', blog.includes("new URL('index.json',CONTENT_BASE)")],
  ['CMS markdown article fetch', blog.includes('.md') && blog.includes('CONTENT_BASE')],
  ['existing client portal login link', layout.includes('../client-login.html')],
  ['static-hosting hash router', read('main.jsx').includes('<HashRouter>')]
];
const failedIntegrations = integrationChecks.filter(([, passed]) => !passed).map(([name]) => name);

if (missingRoutes.length || missingFiles.length || failedIntegrations.length) {
  console.error({ missingRoutes, missingFiles, failedIntegrations });
  process.exit(1);
}
console.log(`Passed: ${requiredRoutes.length} route declarations, ${requiredFiles.length} required source files, and ${integrationChecks.length} integration-contract checks.`);
