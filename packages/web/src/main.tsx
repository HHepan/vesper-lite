import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './contexts/ThemeContext.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import './styles/tui.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
