/* ATEMPORAL · CASA
   Estados técnicos: dibujando → generando → resultado → fin
   Bloques: ESCALA · DIBUJO · EXPORTACIÓN · IA · GUARDADO · ESTADO · ANIMACIÓN */
(function () {
  'use strict';

  var CONFIG = {
    endpointTransformar: '/api/casa/transform',
    endpointGuardar: '/api/casa/save',
    tiempoMaxIA: 120000, maxLadoIA: 512,          // ms
    exportAncho: 1536,            // mismo formato 3:2 que la lámina
    exportAlto: 1024,
    fondoExport: '#F2EEE5',          // hueso de la lámina
    grosorTrazo: 11,              // en px del escenario (1920)
    grosorGoma: 54,
    esperaMinima: 2600,           // ms que dura como mínimo el estado de transformación
    pausaMensaje: 7000,           // ms con el mensaje final antes del cierre
    reinicio: 30000               // ms en el cierre antes de volver a la intro (siguiente participante)
  };
  var PALETA = { negro: '#0E1619', naranja: '#FF6A0E', rojo: '#EF1A0A', amarillo: '#FFD80E', rosa: '#FE3EC9', violeta: '#5600DD', azul: '#0045D4' };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var esc = document.getElementById('escenario');
  var lienzo = document.getElementById('lienzo');
  var punta = document.getElementById('punta');
  var lamina = document.getElementById('lamina');
  var btnTransformar = document.getElementById('transformar');
  var btnConstruir = document.getElementById('construir');
  var fotoCasa = document.getElementById('fotoCasa');
  var miniDibujo = document.getElementById('miniDibujo');
  var mini = document.querySelector('.mini');
  var tapa = document.querySelector('.tapa');

  /* ======================= ESCALA ======================= */
  // Mismo criterio que el sitio (lienzo de 1920 escalado), pero la actividad entra completa en la ventana.
  var S = 1;
  function escalar() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var vertical = vh > vw * 1.15;
    esc.classList.toggle('vertical', vertical);
    var W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
    S = Math.min(vw / W, vh / H);
    esc.style.setProperty('--s', S);
    document.body.style.setProperty('--s', S);
    esc.style.setProperty('--mx', ((vw / S - W) / 2) + 'px');
    esc.style.setProperty('--my', ((vh / S - H) / 2) + 'px');
    dibujo.ajustar();
  }

  /* ======================= DIBUJO ======================= */
  // Los trazos se guardan como datos (coordenadas normalizadas 0..1), así el dibujo nunca se pierde:
  // se vuelve a pintar nítido al redimensionar y se re-exporta a cualquier tamaño.
  var dibujo = (function () {
    var ctx = lienzo.getContext('2d');
    var trazos = [];
    var actual = null, idPuntero = null;
    var anchoCss = 1, altoCss = 1, ratio = 1;

    function ajustar() {
      // medidas de layout (no afectadas por transformaciones de las animaciones)
      anchoCss = lienzo.clientWidth; altoCss = lienzo.clientHeight;   // px del escenario
      if (!anchoCss || !altoCss) return;
      ratio = window.devicePixelRatio || 1;
      var w = Math.round(anchoCss * S * ratio), h = Math.round(altoCss * S * ratio);
      if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
      pintarTodo(ctx, lienzo.width, lienzo.height, null);
    }

    function prepararTrazo(c, t, w) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.lineWidth = t.grosor * w;
      if (t.modo === 'goma') { c.globalCompositeOperation = 'destination-out'; c.strokeStyle = c.fillStyle = '#000'; }
      else { c.globalCompositeOperation = 'source-over'; c.strokeStyle = c.fillStyle = t.color; }
    }
    function pintarTrazo(c, t, w, h) {
      var p = t.puntos; if (!p.length) return;
      prepararTrazo(c, t, w);
      if (p.length === 1) { c.beginPath(); c.arc(p[0][0] * w, p[0][1] * h, c.lineWidth / 2, 0, Math.PI * 2); c.fill(); return; }
      c.beginPath(); c.moveTo(p[0][0] * w, p[0][1] * h);
      for (var i = 1; i < p.length - 1; i++) {        // curvas por puntos medios: trazo fluido
        var mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        c.quadraticCurveTo(p[i][0] * w, p[i][1] * h, mx * w, my * h);
      }
      var u = p[p.length - 1]; c.lineTo(u[0] * w, u[1] * h); c.stroke();
    }
    function pintarTodo(c, w, h, fondo) {
      c.save(); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h);
      // la goma borra solo el dibujo: se pinta en una capa propia y después se compone sobre el fondo
      var capa = c;
      if (fondo) { capa = document.createElement('canvas').getContext('2d'); capa.canvas.width = w; capa.canvas.height = h; }
      trazos.forEach(function (t) { pintarTrazo(capa, t, w, h); });
      if (fondo) { c.fillStyle = fondo; c.fillRect(0, 0, w, h); c.drawImage(capa.canvas, 0, 0); }
      c.restore();
    }
    // tramo nuevo durante el movimiento (sin repintar todo)
    function pintarTramo(t) {
      var w = lienzo.width, h = lienzo.height, p = t.puntos, n = p.length;
      ctx.save(); prepararTrazo(ctx, t, w);
      if (n === 1) { ctx.beginPath(); ctx.arc(p[0][0] * w, p[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
      else {
        var a = p[n - 3] || p[n - 2], b = p[n - 2], c2 = p[n - 1];
        var m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m2 = [(b[0] + c2[0]) / 2, (b[1] + c2[1]) / 2];
        if (n === 2) m1 = a;
        ctx.beginPath(); ctx.moveTo(m1[0] * w, m1[1] * h); ctx.quadraticCurveTo(b[0] * w, b[1] * h, m2[0] * w, m2[1] * h); ctx.stroke();
      }
      ctx.restore();
    }

    // coordenadas del puntero → normalizadas, válidas aunque el lienzo esté escalado con CSS/zoom
    function aNormal(e) {
      var r = lienzo.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    }

    function empezar(e) {
      if (!ui.puedeDibujar() || idPuntero !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      idPuntero = e.pointerId; lienzo.setPointerCapture(idPuntero);
      var goma = herramienta.modo === 'goma';
      actual = { modo: goma ? 'goma' : 'trazo', color: herramienta.color, grosor: (goma ? CONFIG.grosorGoma : CONFIG.grosorTrazo) / anchoCss, puntos: [aNormal(e)] };
      trazos.push(actual); pintarTramo(actual);
      esc.classList.add('dibujando'); punta.classList.add('apoyada');
    }
    function mover(e) {
      cursor.mover(e);
      if (idPuntero !== e.pointerId || !actual) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (!evs.length) evs = [e];
      evs.forEach(function (ev) {
        var p = aNormal(ev), u = actual.puntos[actual.puntos.length - 1];
        if (Math.abs(p[0] - u[0]) + Math.abs(p[1] - u[1]) < 0.0008) return;
        actual.puntos.push(p); pintarTramo(actual);
      });
    }
    function terminar(e) {
      if (idPuntero !== e.pointerId) return;
      idPuntero = null; actual = null;
      esc.classList.remove('dibujando'); punta.classList.remove('apoyada');
      ui.revisarTinta();
    }
    lienzo.addEventListener('pointerdown', empezar);
    lienzo.addEventListener('pointermove', mover);
    lienzo.addEventListener('pointerup', terminar);
    lienzo.addEventListener('pointercancel', terminar);
    lienzo.addEventListener('lostpointercapture', terminar);
    lienzo.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // ¿hay al menos un trazo visible? (si la goma borró todo, no)
    function tieneTinta() {
      if (!trazos.some(function (t) { return t.modo === 'trazo'; })) return false;
      var w = 240, h = 160, c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d', { willReadFrequently: true }); trazos.forEach(function (t) { pintarTrazo(x, t, w, h); });
      var d = x.getImageData(0, 0, w, h).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 24) return true;
      return false;
    }

    // EXPORTACIÓN: canvas auxiliar con fondo sólido + el dibujo → PNG
    function exportarPNG(ancho, alto, fondo) {
      // la lámina es más ancha que el formato de salida: el dibujo entra completo, centrado, sin deformarse
      var c = document.createElement('canvas'); c.width = ancho; c.height = alto;
      var x = c.getContext('2d'), asp = anchoCss / altoCss;
      var dw = ancho, dh = Math.round(ancho / asp);
      if (dh > alto) { dh = alto; dw = Math.round(alto * asp); }
      var t = document.createElement('canvas'); t.width = dw; t.height = dh;
      pintarTodo(t.getContext('2d'), dw, dh, null);
      x.fillStyle = fondo; x.fillRect(0, 0, ancho, alto);
      x.drawImage(t, Math.round((ancho - dw) / 2), Math.round((alto - dh) / 2));
      return new Promise(function (ok, mal) {
        if (c.toBlob) c.toBlob(function (b) { b ? ok(b) : mal(new Error('toBlob devolvió vacío')); }, 'image/png');
        else fetch(c.toDataURL('image/png')).then(function (r) { return r.blob(); }).then(ok, mal);
      });
    }

    function limpiar() { trazos.length = 0; actual = null; idPuntero = null; pintarTodo(ctx, lienzo.width, lienzo.height, null); }

    // PNG con fondo blanco sólido y encima el dibujo exacto. maxLado: escala para que el lado mayor
    // no supere ese valor, sin deformar (proporción del lienzo). Sin maxLado: resolución original.
    function exportarBlanco(maxLado) {
      var k = maxLado ? Math.min(1, maxLado / Math.max(lienzo.width, lienzo.height)) : 1;
      var w = Math.max(1, Math.floor(lienzo.width * k)), h = Math.max(1, Math.floor(lienzo.height * k));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d');
      x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, w, h);
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(lienzo, 0, 0, w, h);
      return new Promise(function (ok, mal) {
        c.toBlob(function (b) { b ? ok(b) : mal(new Error('toBlob devolvió vacío')); }, 'image/png');
      });
    }
    function exportarOriginal() { return exportarBlanco(0); }          // alta resolución: lo que se guarda
    function exportarParaIA() { return exportarBlanco(CONFIG.maxLadoIA); }   // reducido: solo para la IA

    return { ajustar: ajustar, tieneTinta: tieneTinta, exportarPNG: exportarPNG, exportarParaIA: exportarParaIA, exportarOriginal: exportarOriginal, limpiar: limpiar, trazos: function () { return trazos; } };
  })();

  /* ======================= HERRAMIENTAS ======================= */
  var herramienta = { modo: 'trazo', colorNombre: 'negro', color: PALETA.negro };
  var botonesModo = [].slice.call(document.querySelectorAll('.modo'));
  var botonesColor = [].slice.call(document.querySelectorAll('.color'));

  function elegirModo(m) {
    herramienta.modo = m;
    esc.dataset.modo = m;
    botonesModo.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.modo === m)); });
    cursor.actualizar();
  }
  function elegirColor(nombre, desdeClick) {
    herramienta.colorNombre = nombre; herramienta.color = PALETA[nombre];
    document.documentElement.style.setProperty('--tinta', herramienta.color);
    botonesColor.forEach(function (b) {
      var on = b.dataset.color === nombre; b.setAttribute('aria-pressed', String(on));
      if (on && desdeClick && !reduce) { b.classList.remove('pica'); void b.offsetWidth; b.classList.add('pica'); }
    });
    if (herramienta.modo !== 'trazo') elegirModo('trazo');   // elegir color vuelve al trazo con ese color
    cursor.actualizar();
  }
  botonesModo.forEach(function (b) { b.addEventListener('click', function () { if (ui.puedeDibujar()) elegirModo(b.dataset.modo); }); });
  botonesColor.forEach(function (b) {
    b.addEventListener('click', function () { if (ui.puedeDibujar()) elegirColor(b.dataset.color, true); });
    b.addEventListener('animationend', function () { b.classList.remove('pica'); });
  });

  /* puntero gráfico sobre la lámina */
  var cursor = (function () {
    function actualizar() {
      var d = (herramienta.modo === 'goma' ? CONFIG.grosorGoma : CONFIG.grosorTrazo);
      punta.style.setProperty('--d', d + 'px');
    }
    function mover(e) {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') { punta.classList.remove('ver'); lienzo.classList.remove('punta-activa'); return; }
      var r = esc.getBoundingClientRect();
      var x = (e.clientX - r.left) / (r.width / esc.offsetWidth), y = (e.clientY - r.top) / (r.height / esc.offsetHeight);
      punta.style.translate = x + 'px ' + y + 'px';
      var ver = ui.puedeDibujar();
      punta.classList.toggle('ver', ver); lienzo.classList.toggle('punta-activa', ver);
    }
    lienzo.addEventListener('pointerleave', function () { punta.classList.remove('ver'); });
    lienzo.addEventListener('pointerenter', mover);
    return { actualizar: actualizar, mover: mover };
  })();

  /* ======================= IA ======================= */
  // El navegador solo habla con el endpoint propio. La clave del proveedor vive en el servidor.
  var participanteId = (function () {
    var q = new URLSearchParams(location.search);
    var id = q.get('participante') || q.get('participantId');
    try { id = id || localStorage.getItem('atemporal:participante'); } catch (e) { }
    return id || null;
  })();

  function transformHouse(drawingBlob) {
    var fd = new FormData();
    fd.append('drawing', drawingBlob, 'dibujo.png');
    if (participanteId) fd.append('participantId', participanteId);
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, CONFIG.tiempoMaxIA);
    return fetch(CONFIG.endpointTransformar, { method: 'POST', body: fd, signal: ctrl.signal })
      .then(function (r) {
        clearTimeout(t);
        if (!r.ok) return r.text().then(function (txt) { throw new Error('transform ' + r.status + ' ' + txt); });
        var tipo = r.headers.get('content-type') || '';
        if (tipo.indexOf('image/') === 0) return r.blob();
        // Workers AI: { image: "<base64>", mime }
        return r.json().then(function (d) {
          if (!d || !d.image) throw new Error('transform: respuesta sin imagen');
          return base64ABlob(d.image, d.mime || 'image/jpeg');
        });
      }, function (err) { clearTimeout(t); throw err; });
  }
  function base64ABlob(b64, mime) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: mime });
  }

  /* ======================= GUARDADO ======================= */
  function saveHouseResult(datos) {
    var fd = new FormData();
    if (datos.participantId) fd.append('participantId', datos.participantId);
    fd.append('drawingImage', datos.drawingImage, 'dibujo.png');
    fd.append('generatedImage', datos.generatedImage, 'casa.' + ((datos.generatedImage.type || 'image/png').split('/')[1] || 'png'));
    fd.append('completed', 'true');
    return fetch(CONFIG.endpointGuardar, { method: 'POST', body: fd })
      .then(function (r) { if (!r.ok) throw new Error('save ' + r.status); return r.json(); })
      .catch(function (err) {
        console.warn('[casa] no se pudo guardar en el servidor, se guarda la copia local de respaldo', err);
        return guardarLocal(datos);
      });
  }
  // Respaldo técnico local (IndexedDB). No cambia la interfaz.
  function guardarLocal(datos) {
    return new Promise(function (ok, mal) {
      if (!window.indexedDB) return mal(new Error('sin IndexedDB'));
      var pet = indexedDB.open('atemporal', 1);
      pet.onupgradeneeded = function () { pet.result.createObjectStore('casa', { autoIncrement: true }); };
      pet.onerror = function () { mal(pet.error); };
      pet.onsuccess = function () {
        var tx = pet.result.transaction('casa', 'readwrite');
        tx.objectStore('casa').add({ participantId: datos.participantId, drawingImage: datos.drawingImage, generatedImage: datos.generatedImage, completed: true });
        tx.oncomplete = function () { ok({ ok: true, local: true }); };
        tx.onerror = function () { mal(tx.error); };
      };
    });
  }

  /* ======================= ESTADO ======================= */
  var ui = (function () {
    var estado = 'dibujando';
    var dibujoBlob = null, miniaturaBlob = null, casaBlob = null, urls = [];

    var rotuloSeccion = document.getElementById('rotuloSeccion');
    function set(e) {
      estado = e; esc.dataset.estado = e;
      rotuloSeccion.textContent = e === 'intro' ? 'Inicio / Casa' : 'Casa';
      if (e === 'dibujando' || e === 'intro') setTimeout(dibujo.ajustar, 0);
      if (e !== 'dibujando') { punta.classList.remove('ver'); lienzo.classList.remove('punta-activa'); }
    }
    function puedeDibujar() { return estado === 'dibujando'; }
    function revisarTinta() { if (estado === 'dibujando') btnTransformar.disabled = !dibujo.tieneTinta(); }

    btnTransformar.addEventListener('click', function () {
      if (estado !== 'dibujando' || btnTransformar.disabled) return;   // un solo pedido a la vez
      btnTransformar.disabled = true;
      set('generando');
      var t0 = Date.now();
      function esperar(v) { return new Promise(function (ok) { setTimeout(function () { ok(v); }, Math.max(0, CONFIG.esperaMinima - (Date.now() - t0))); }); }
      Promise.all([dibujo.exportarOriginal(), dibujo.exportarPNG(CONFIG.exportAncho, CONFIG.exportAlto, CONFIG.fondoExport), dibujo.exportarParaIA()])
        .then(function (b) {
          dibujoBlob = b[0];          // dibujo original en alta resolución (lo que se guarda)
          miniaturaBlob = b[1];       // misma vista de siempre para la miniatura
          return transformHouse(b[2]);   // versión ≤ 512 px, solo para la IA
        })
        .then(esperar)
        .then(function (img) { casaBlob = img; return mostrarResultado(img); })
        .catch(function (err) {
          console.error('[casa] la transformación falló; el dibujo se conserva y se puede volver a intentar', err);
          set('dibujando');
          revisarTinta();
          if (!reduce) { btnTransformar.classList.remove('tiembla-err'); void btnTransformar.offsetWidth; btnTransformar.classList.add('tiembla-err'); }
        });
    });
    btnTransformar.addEventListener('animationend', function () { btnTransformar.classList.remove('tiembla-err'); });

    function mostrarResultado(img) {
      var u1 = URL.createObjectURL(img), u2 = URL.createObjectURL(miniaturaBlob || dibujoBlob); urls.push(u1, u2);
      fotoCasa.src = u1; miniDibujo.src = u2;
      return Promise.all([fotoCasa.decode ? fotoCasa.decode() : Promise.resolve(), miniDibujo.decode ? miniDibujo.decode() : Promise.resolve()])
        .then(function () {
          set('resultado');
          btnTransformar.hidden = true;
          return animacion.revelar();
        })
        .then(function () {
          btnConstruir.hidden = false; btnConstruir.disabled = false;
          if (!reduce) btnConstruir.classList.add('aparece-btn');
          btnConstruir.focus({ preventScroll: true });
        });
    }

    btnConstruir.addEventListener('click', function () {
      if (estado !== 'resultado' || btnConstruir.disabled) return;
      btnConstruir.disabled = true;
      saveHouseResult({ participantId: participanteId, drawingImage: dibujoBlob, generatedImage: casaBlob, completed: true })
        .then(function (r) {
          console.info('[casa] guardado', r);
          btnConstruir.hidden = true;
          set('fin');
          timers.push(setTimeout(irAlCierre, CONFIG.pausaMensaje));
        })
        .catch(function (err) {
          console.error('[casa] no se pudo guardar; el resultado se conserva', err);
          btnConstruir.disabled = false;
          if (!reduce) { btnConstruir.classList.remove('tiembla-err'); void btnConstruir.offsetWidth; btnConstruir.classList.add('tiembla-err'); }
        });
    });
    btnConstruir.addEventListener('animationend', function (e) { btnConstruir.classList.remove('aparece-btn', 'tiembla-err'); });

    /* intro → actividad → mensaje → cierre → intro (siguiente participante) */
    var timers = [];
    function limpiarTimers() { timers.forEach(clearTimeout); timers = []; }
    document.getElementById('empezar').addEventListener('click', function () {
      if (estado !== 'intro' || animacion.cortinaActiva()) return;
      animacion.cortina(function () { set('dibujando'); esc.classList.add('entra'); setTimeout(function () { esc.classList.remove('entra'); }, 700); });
    });
    function irAlCierre() {
      if (estado !== 'fin') return;
      animacion.cortina(function () { document.getElementById('cierreFoto').src = fotoCasa.src; document.getElementById('cierreDibujo').src = miniDibujo.src; set('cierre'); timers.push(setTimeout(volverAlInicio, CONFIG.reinicio)); });
    }
    function volverAlInicio() {
      if (estado !== 'cierre' || animacion.cortinaActiva()) return;
      limpiarTimers();
      animacion.cortina(function () { reiniciar(); set('intro'); });
    }
    document.getElementById('cierre').addEventListener('click', volverAlInicio);
    document.getElementById('cierre').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); volverAlInicio(); } });
    function reiniciar() {
      dibujo.limpiar();
      urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
      dibujoBlob = miniaturaBlob = casaBlob = null;
      ['fotoCasa', 'miniDibujo', 'cierreFoto', 'cierreDibujo'].forEach(function (id) { document.getElementById(id).removeAttribute('src'); }); tapa.innerHTML = '';
      btnTransformar.hidden = false; btnTransformar.disabled = true;
      btnConstruir.hidden = true; btnConstruir.disabled = false;
      elegirColor('negro', false); elegirModo('trazo');
    }

    return { set: set, puedeDibujar: puedeDibujar, revisarTinta: revisarTinta, estado: function () { return estado; } };
  })();

  /* ======================= ANIMACIÓN ======================= */
  var animacion = (function () {
    var colores = ['var(--rojo)', 'var(--fondo)', 'var(--rojo)', 'var(--hueso)'];
    // bloques de carga y barrido (se arman una vez)
    var bloques = document.querySelector('.bloques'), barrido = document.querySelector('.barrido');
    for (var i = 0; i < 24; i++) { var b = document.createElement('i'); b.style.setProperty('--n', i); bloques.appendChild(b); }
    for (var j = 0; j < 16; j++) { var s = document.createElement('i'); s.style.setProperty('--n', j); barrido.appendChild(s); }

    // la foto aparece por bloques: la lámina pasa de estructura gráfica a imagen
    function revelar() {
      tapa.innerHTML = '';
      var celdas = [];
      for (var k = 0; k < 70; k++) {
        var c = document.createElement('i');
        c.style.setProperty('--c', colores[(k * 7 + (k >> 3)) % colores.length]);
        c.style.setProperty('--dx', (Math.random() * 24 - 12).toFixed(0) + 'px');
        c.style.setProperty('--dy', (Math.random() * 24 - 12).toFixed(0) + 'px');
        c.style.setProperty('--rr', (Math.random() * 30 - 15).toFixed(0) + 'deg');
        tapa.appendChild(c); celdas.push(c);
      }
      if (!reduce) { mini.classList.remove('vuela'); void mini.offsetWidth; mini.classList.add('vuela'); }
      if (reduce) { celdas.forEach(function (c) { c.classList.add('fuera'); }); return Promise.resolve(); }
      lamina.classList.add('revelando');
      // orden: en tandas desordenadas, como un revelado por partes
      var orden = celdas.slice().sort(function () { return Math.random() - .5; });
      return new Promise(function (ok) {
        var tanda = 0, porTanda = 6;
        var iv = setInterval(function () {
          orden.slice(tanda * porTanda, (tanda + 1) * porTanda).forEach(function (c) { c.classList.add('fuera'); });
          tanda++;
          if (tanda * porTanda >= orden.length) {
            clearInterval(iv);
            setTimeout(function () {
              lamina.classList.remove('revelando'); lamina.classList.add('asienta');
              setTimeout(function () { lamina.classList.remove('asienta'); ok(); }, 320);
            }, 140);
          }
        }, 70);
      });
    }
    // cortina de bloques entre escenas: cubre, cambia la escena y descubre
    var cort = document.getElementById('cortina'), activa = false;
    for (var q = 0; q < 16 * 9; q++) { var ce = document.createElement('i'); ce.style.setProperty('--c', colores[(q * 5 + (q >> 4)) % colores.length]); cort.appendChild(ce); }
    function cortina(cambiar) {
      if (reduce) { cambiar(); return; }
      activa = true;
      var cel = [].slice.call(cort.children).sort(function () { return Math.random() - .5; }), lote = 24, i = 0;
      cort.classList.add('activa');
      var iv = setInterval(function () {
        cel.slice(i, i + lote).forEach(function (c) { c.classList.add('on'); }); i += lote;
        if (i >= cel.length) {
          clearInterval(iv); cambiar();
          var j2 = 0;
          setTimeout(function () {
            var iv2 = setInterval(function () {
              cel.slice(j2, j2 + lote).forEach(function (c) { c.classList.remove('on'); }); j2 += lote;
              if (j2 >= cel.length) { clearInterval(iv2); cort.classList.remove('activa'); activa = false; }
            }, 45);
          }, 120);
        }
      }, 45);
    }
    return { revelar: revelar, cortina: cortina, cortinaActiva: function () { return activa; } };
  })();

  /* ======================= FIGURAS Y TÍTULO (lenguaje del sitio) ======================= */
  // letras del título que reaccionan
  document.querySelectorAll('.titulo .k, .intro-preg .k, .intro-preg .b').forEach(function (el) {
    var t = el.textContent; el.textContent = '';
    var w = document.createElement('span'); w.className = 'w';
    Array.from(t).forEach(function (ch) { var s = document.createElement('span'); s.className = 'ch'; s.textContent = ch === ' ' ? '\u00a0' : ch; w.appendChild(s); });
    el.appendChild(w);
  });
  // figuras arrastrables (secundarias)
  document.querySelectorAll('.fig').forEach(function (f) {
    var x = 0, y = 0, sx, sy, ox, oy, movio = false, id = null;
    f.addEventListener('pointerdown', function (e) { id = e.pointerId; f.setPointerCapture(id); sx = e.clientX; sy = e.clientY; ox = x; oy = y; movio = false; f.classList.add('agarrada'); });
    f.addEventListener('pointermove', function (e) {
      if (id !== e.pointerId) return;
      var dx = (e.clientX - sx) / S, dy = (e.clientY - sy) / S; if (Math.abs(dx) + Math.abs(dy) > 4) movio = true;
      x = ox + dx; y = oy + dy; f.style.translate = x + 'px ' + y + 'px';
    });
    function soltar(e) {
      if (id !== e.pointerId) return; id = null; f.classList.remove('agarrada');
      if (!movio && !reduce) { f.classList.remove('pop'); void f.getBoundingClientRect(); f.classList.add('pop'); }
    }
    f.addEventListener('pointerup', soltar); f.addEventListener('pointercancel', soltar);
    f.addEventListener('animationend', function (e) { if (e.animationName === 'pop') f.classList.remove('pop'); });
  });

  /* ondas del fondo: se corren apenas con el puntero, en saltos */
  (function () {
    if (reduce) return;
    var ultimo = '';
    window.addEventListener('pointermove', function (e) {
      var ox = Math.round(((e.clientX / window.innerWidth) - .5) * -36 / 9) * 9;
      var oy = Math.round(((e.clientY / window.innerHeight) - .5) * -18 / 6) * 6;
      var k = ox + ',' + oy; if (k === ultimo) return; ultimo = k;
      document.body.style.setProperty('--ox', (ox * S) + 'px'); document.body.style.setProperty('--oy', (oy * S) + 'px');
    }, { passive: true });
  })();

  /* ======================= INICIO ======================= */
  var rt;
  window.addEventListener('resize', function () { escalar(); clearTimeout(rt); rt = setTimeout(escalar, 120); });
  escalar();
  elegirColor('negro', false);
  ui.set('intro');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(escalar);
  setTimeout(function () { esc.classList.remove('entra'); dibujo.ajustar(); }, 700);

  // acceso para pruebas técnicas (sin efecto en la interfaz)
  window.__casa = { estado: ui.estado, trazos: dibujo.trazos, exportarPNG: dibujo.exportarPNG };
})();
