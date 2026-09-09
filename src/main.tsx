import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/dm-sans';
import './styles.css';
import App from './App';
import { applyPalette } from './theme/palette';

applyPalette(document.documentElement.style);
const root = document.getElementById('root');
if (!root) throw new Error('The application root element is missing.');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
