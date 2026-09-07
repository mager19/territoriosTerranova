import { mountLanding } from './landing';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root container #root not found');
}

mountLanding(container);
