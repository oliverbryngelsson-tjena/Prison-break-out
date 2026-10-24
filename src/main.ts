import './ui/styles.css';
import { App } from './app';

const app = new App(document.getElementById('app')!);
app.boot().catch((e) => {
  console.error(e);
  const msg = document.getElementById('boot-msg');
  if (msg) msg.textContent = 'Could not start: ' + ((e as Error)?.message ?? String(e)) + ' — your browser needs WebGL 2.';
});
