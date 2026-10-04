import { createRoot } from 'react-dom/client';
import { App } from './App';
// Brand typefaces (ZenCabs Brand Guidelines), bundled so the console works offline.
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './styles.css';

// No StrictMode: drei <Html> portals log spurious unmount warnings under its double-mount.
createRoot(document.getElementById('root')!).render(<App />);
