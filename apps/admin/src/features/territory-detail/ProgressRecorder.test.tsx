import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProgressRecorder } from './ProgressRecorder.js';

describe('ProgressRecorder', () => {
  it('prioritizes explicit pending-area recording while keeping secondary evidence and no actor input', () => {
    const html = renderToStaticMarkup(
      <ProgressRecorder territoryId={1} boundary={null} onRecorded={() => undefined} />
    );

    expect(html).toContain('aria-label="Herramientas de progreso"');
    expect(html).toContain('Dibujar área pendiente');
    expect(html).toContain('Cerrar área pendiente');
    expect(html).toContain('Dibujar ruta');
    expect(html).toContain('Colocar pausa');
    expect(html).toContain('Quitar pausa');
    expect(html).toContain('Cancelar registro');
    expect(html).not.toContain('progress-recorded-by');
  });
});
