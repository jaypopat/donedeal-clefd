import { defineConfig } from 'wxt';
import { API_BASE } from './lib/extension/config';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tyrekick',
    description: 'Price and warning signals on DoneDeal car listings, compared with the search you are viewing.',
    permissions: ['storage'],
    host_permissions: ['https://www.donedeal.ie/*', `${API_BASE}/*`],
  },
});
