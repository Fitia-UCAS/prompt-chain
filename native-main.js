import {init} from './native-ui.js';
await init();
await import('./assets/native-panel.js');
document.getElementById('preloader')?.remove();
