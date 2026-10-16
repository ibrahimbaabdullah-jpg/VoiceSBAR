// Cloudflare Pages Functions entry point: every /api/* request is handled by the Hono app.
import { handle } from 'hono/cloudflare-pages';
import { createApp } from '../../server/app';

export const onRequest = handle(createApp());
