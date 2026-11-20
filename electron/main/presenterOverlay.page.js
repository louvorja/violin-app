// Página da janela transparente do laser e da lousa (ver presenterOverlay.js).
// O main chama `window.ov.*` por executeJavaScript; não há ponte nem Node aqui.
(function () {
  "use strict";
  var aspect = 16 / 9;
  var strokes = [];
  var board = document.getElementById("board");
  var ink = document.getElementById("ink");
  var dot = document.getElementById("laser");

  /** Área do slide encaixada na tela pela proporção do que está no ar. */
  function area() {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var w = W;
    var h = W / aspect;
    if (h > H) {
      h = H;
      w = H * aspect;
    }
    return { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h };
  }

  function layout() {
    var r = area();
    board.style.left = r.x + "px";
    board.style.top = r.y + "px";
    board.style.width = r.w + "px";
    board.style.height = r.h + "px";
    redraw();
  }

  function ctx() {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(window.innerWidth * dpr);
    var h = Math.round(window.innerHeight * dpr);
    if (ink.width !== w || ink.height !== h) {
      ink.width = w;
      ink.height = h;
    }
    var c = ink.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  function draw(c, s, r) {
    var pts = s.points || [];
    if (!pts.length) return;
    c.save();
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineWidth = Math.max(1.5, (s.size || 4) * r.w / 1000);
    c.lineCap = "round";
    c.lineJoin = "round";
    var X = function (p) { return r.x + p[0] * r.w; };
    var Y = function (p) { return r.y + p[1] * r.h; };
    if (pts.length === 1) {
      c.beginPath();
      c.arc(X(pts[0]), Y(pts[0]), c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.beginPath();
      c.moveTo(X(pts[0]), Y(pts[0]));
      for (var i = 1; i < pts.length; i++) c.lineTo(X(pts[i]), Y(pts[i]));
      c.stroke();
    }
    c.restore();
  }

  function redraw() {
    var c = ctx();
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    var r = area();
    for (var i = 0; i < strokes.length; i++) draw(c, strokes[i], r);
  }

  window.ov = {
    setAspect: function (a) {
      aspect = a > 0 ? a : 16 / 9;
      layout();
    },
    setBoard: function (on) {
      board.style.display = on ? "block" : "none";
    },
    sync: function (list) {
      strokes = Array.isArray(list) ? list.slice() : [];
      redraw();
    },
    stroke: function (s) {
      strokes.push(s);
      draw(ctx(), s, area());
    },
    laser: function (x, y) {
      var r = area();
      dot.style.left = r.x + x * r.w + "px";
      dot.style.top = r.y + y * r.h + "px";
      dot.style.display = "block";
    },
    laserHide: function () {
      dot.style.display = "none";
    },
  };

  window.addEventListener("resize", layout);
  layout();
})();
