import { createApp } from '../src/server.js';

const app = createApp();

export default async function handler(req, res) {
  return app(req, res);
}
