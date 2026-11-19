/* Test di MM.exporter (usa il renderer reale su un SVG fuori schermo) */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  /** Disegna la mappa in un SVG temporaneo; il chiamante deve chiamare done(). */
  function drawn(map) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '800');
    svg.setAttribute('height', '600');
    svg.style.position = 'absolute';
    svg.style.left = '-10000px';
    svg.appendChild(document.createElementNS(NS, 'defs'));
    var world = document.createElementNS(NS, 'g');
    world.setAttribute('id', 'world');
    svg.appendChild(world);
    document.body.appendChild(svg);
    var renderer = MM.renderer.create(svg);
    var laid = MM.layout.apply(map);
    renderer.render(laid, { selectedId: laid.rootId });
    return {
      map: laid, renderer: renderer,
      done: function () { renderer.destroy(); document.body.removeChild(svg); }
    };
  }

  describe('exporter', function () {
    it('fitScale riduce la scala per immagini enormi', function () {
      assert.equal(MM.exporter.fitScale(1000, 800, 2), 2);
      var s = MM.exporter.fitScale(6000, 6000, 2);
      assert.ok(6000 * s <= 8192 && 6000 * s * 6000 * s <= 16000001, 'scala troppo grande: ' + s);
    });

    it('toSVGString produce un SVG valido, completo e senza selezione', function () {
      var d = drawn(MM.templates.create('confronto'));
      try {
        var text = MM.exporter.toSVGString(d.map, d.renderer);
        var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        assert.ok(!doc.querySelector('parsererror'), 'SVG non valido');
        assert.equal(doc.querySelectorAll('.node').length, Object.keys(d.map.nodes).length);
        assert.equal(doc.querySelectorAll('.selected').length, 0);
        assert.equal(doc.querySelectorAll('.link-hit, .measure').length, 0);
        assert.ok(doc.getElementById('mmx-arrow'), 'manca la punta di freccia');
        assert.equal(doc.querySelector('title').textContent, d.map.title);
      } finally { d.done(); }
    });

    it('il riquadro esportato contiene tutti i nodi', function () {
      var d = drawn(MM.templates.create('analisi-testo'));
      try {
        var box = MM.exporter.exportBounds(d.map, d.renderer);
        var b = MM.layout.getBounds(d.map);
        assert.ok(box.x <= b.minX && box.y <= b.minY, 'angolo in alto a sinistra');
        assert.ok(box.x + box.width >= b.maxX && box.y + box.height >= b.maxY, 'angolo in basso a destra');
      } finally { d.done(); }
    });

    it('toPNG restituisce un\'immagine PNG', function () {
      var d = drawn(MM.templates.create('personaggio-storico'));
      return MM.exporter.toPNG(d.map, d.renderer, 1).then(function (blob) {
        d.done();
        assert.equal(blob.type, 'image/png');
        assert.ok(blob.size > 1000, 'PNG troppo piccolo');
      }, function (e) { d.done(); throw e; });
    });
  });
})();
