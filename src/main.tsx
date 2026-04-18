import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './App';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
