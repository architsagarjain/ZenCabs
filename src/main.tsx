import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// No StrictMode: drei <Html> portals log spurious unmount warnings under its double-mount.
createRoot(document.getElementById('root')!).render(<App />);
