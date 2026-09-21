import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root container #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
