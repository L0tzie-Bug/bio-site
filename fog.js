const FOG_VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";

const FOG_FRAG = `
precision mediump float;
uniform vec2 r;
uniform float t;
uniform float z;
uniform vec2 m;
uniform vec3 cLow;
uniform vec3 cMid;
uniform vec3 cHigh;
uniform float vig;

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++){
    v += a * noise(p);
    p = p * 2.02 + vec2(7.1, 3.7);
    a *= 0.5;
  }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / r.y;
  vec2 p = uv * z + m * 0.35;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.11)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.09, 0.0)));
  vec2 s = vec2(fbm(p + 2.2 * q + vec2(1.7, 9.2) + t * 0.06), fbm(p + 2.2 * q + vec2(8.3, 2.8) - t * 0.05));
  float f = fbm(p + 2.4 * s);
  float d = smoothstep(0.18, 0.78, f);
  vec3 col = mix(cLow, cMid, d);
  col = mix(col, cHigh, smoothstep(0.55, 1.0, f * f * 1.7 + s.x * 0.25));
  vec2 c = gl_FragCoord.xy / r - 0.5;
  col *= 1.0 - dot(c, c) * vig;
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function createFog(canvas, opts) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  const vs = compile(gl.VERTEX_SHADER, FOG_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FOG_FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  ["r", "t", "z", "m", "cLow", "cMid", "cHigh", "vig"].forEach((n) => (u[n] = gl.getUniformLocation(prog, n)));

  gl.uniform3fv(u.cLow, hexToRgb(opts.low));
  gl.uniform3fv(u.cMid, hexToRgb(opts.mid));
  gl.uniform3fv(u.cHigh, hexToRgb(opts.high));
  gl.uniform1f(u.z, opts.zoom);
  gl.uniform1f(u.vig, opts.vignette);

  function resize() {
    const w = Math.max(2, Math.round(canvas.clientWidth * opts.scale));
    const h = Math.max(2, Math.round(canvas.clientHeight * opts.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.r, canvas.width, canvas.height);
  }

  function render(time, mx, my) {
    gl.uniform1f(u.t, time * opts.speed);
    gl.uniform2f(u.m, mx, my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  resize();
  return { resize, render };
                }
