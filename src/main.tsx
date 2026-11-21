import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FirebaseProvider } from './contexts/FirebaseContext.tsx';
import './index.css';
import { restoreVaultToLocalStorage } from './services/persistentStorage';

registerSW({ immediate: true });

restoreVaultToLocalStorage().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <FirebaseProvider>
        <App />
      </FirebaseProvider>
    </ErrorBoundary>
  );
});
