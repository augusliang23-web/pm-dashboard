import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfRenderer } from '../src/pdf-renderer.js';

test('reuses a connected browser and closes each request page', async () => {
  let launches = 0;
  let launchOptions;
  let closes = 0;
  let evaluations = 0;
  const browser = {
    isConnected: () => true,
    newPage: async () => ({
      setContent: async () => {},
      evaluate: async paginator => { evaluations += 1; assert.equal(typeof paginator, 'function'); },
      pdf: async () => new Uint8Array([1, 2, 3]),
      close: async () => { closes += 1; }
    })
  };
  const render = createPdfRenderer({ launch: async options => {
    launches += 1;
    launchOptions = options;
    return browser;
  } });

  await render('<html>A</html>');
  await render('<html>B</html>');

  assert.equal(launches, 1);
  assert.equal(launchOptions.headless, 'shell');
  assert.equal(closes, 2);
  assert.equal(evaluations, 2);
});

test('closes the request page when PDF generation fails', async () => {
  let closes = 0;
  const render = createPdfRenderer({
    launch: async () => ({
      isConnected: () => true,
      newPage: async () => ({
        setContent: async () => {},
        evaluate: async () => {},
        pdf: async () => { throw new Error('render failed'); },
        close: async () => { closes += 1; }
      })
    })
  });

  await assert.rejects(() => render('<html>broken</html>'), /render failed/);
  assert.equal(closes, 1);
});

test('relaunches once when a cached browser disconnects before page creation', async () => {
  let launches = 0;
  const disconnected = {
    isConnected: () => false,
    newPage: async () => { throw new Error('browser disconnected'); }
  };
  const connected = {
    isConnected: () => true,
    newPage: async () => ({
      setContent: async () => {},
      evaluate: async () => {},
      pdf: async () => new Uint8Array([4]),
      close: async () => {}
    })
  };
  const render = createPdfRenderer({
    launch: async () => (++launches === 1 ? disconnected : connected)
  });

  const output = await render('<html>retry</html>');

  assert.equal(launches, 2);
  assert.deepEqual(output, new Uint8Array([4]));
});

test('exposes explicit browser cleanup for local rendering tools', async () => {
  let browserCloses = 0;
  const render = createPdfRenderer({
    launch: async () => ({
      isConnected: () => true,
      newPage: async () => ({
        setContent: async () => {},
        evaluate: async () => {},
        pdf: async () => new Uint8Array([1]),
        close: async () => {}
      }),
      close: async () => { browserCloses += 1; }
    })
  });

  await render('<html>sample</html>');
  await render.close();

  assert.equal(browserCloses, 1);
});
