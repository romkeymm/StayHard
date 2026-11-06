// Lets plain Node (tests, scripts) import 'next/og' the way Next's bundler does.
// Usage: node --import ./tests/next-resolve.mjs ...
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    return next(spec === 'next/og' ? 'next/og.js' : spec, ctx);
  }
`), import.meta.url);
