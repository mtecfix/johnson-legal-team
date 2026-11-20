import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const app = fs.readFileSync(path.join(root, 'App.jsx'), 'utf8');
const required = ['/','/practice-areas','/about','/contact','/blog'];
const missing = required.filter(route => !app.includes(`path="${route}"`));
const files = ['main.jsx','App.jsx','components/Button.jsx','components/Cards.jsx','components/Layout.jsx','pages/Home.jsx','pages/PracticeAreas.jsx','pages/About.jsx','pages/Contact.jsx','pages/Blog.jsx','styles/tokens.css','styles/global.css'];
const absent = files.filter(file => !fs.existsSync(path.join(root,file)));
if (missing.length || absent.length) {
  console.error({missingRoutes:missing, missingFiles:absent});
  process.exit(1);
}
console.log(`Route smoke check passed: ${required.length} required public routes and ${files.length} source files present.`);
