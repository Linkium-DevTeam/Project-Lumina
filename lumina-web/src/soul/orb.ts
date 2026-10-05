import { paramsFor, type OrbParams } from "./palette.js";
import type { Mood } from "../lib/api.js";

/**
 * 灵魂光球渲染引擎：单份全屏片元着色器。
 * 情绪 → 目标参数（色温/呼吸频率/湍流/亮度），每帧向目标平滑滑移；
 * 呼吸相位在 JS 侧积分，改频率时相位连续、不跳变。
 */

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform float u_phase;
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform float u_turb;
uniform float u_bright;
uniform float u_swirl;
uniform float u_voice;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.3, 7.7);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float r = length(uv);

  // 呼吸：缓入缓出的脉动
  float br = pow(0.5 + 0.5 * sin(u_phase), 1.5);

  // 思考时的差速涡旋：靠核心转得更快
  float ang = atan(uv.y, uv.x) + u_swirl * u_time * 1.1 * (1.3 - r * 2.2);
  vec2 suv = r * vec2(cos(ang), sin(ang));

  // 膜面：双重域扭曲的 fbm，有机呼吸的轮廓
  vec2 np = suv * 2.4 + vec2(u_time * 0.13, -u_time * 0.11);
  float w = fbm(np + 0.6 * fbm(np));
  float wob = (w - 0.5) * (0.10 + 0.30 * u_turb);

  float R = 0.36 * (1.0 + 0.05 * br);
  float edge = R + wob;

  float body = smoothstep(edge, edge - 0.22, r);
  float halo = exp(-max(r - edge, 0.0) * 7.0) * 0.6;

  // 内核随呼吸明灭
  float core = exp(-r * r * 11.0) * (0.85 + 0.55 * br);

  // 裂痕中的光：噪声中线的细丝（"万物皆有裂痕，那是光照进来的地方"）
  float cr = fbm(suv * 3.1 + u_time * 0.05);
  float fil = pow(1.0 - abs(cr - 0.5) * 2.0, 14.0) * smoothstep(edge, edge * 0.45, r);

  // 说话时的涟漪：从核心向外荡开
  float rip = sin(r * 34.0 - u_time * 8.0) * u_voice * 0.16 * smoothstep(edge, edge * 0.35, r);

  vec3 col = mix(u_colA, u_colB, clamp(core + 0.3 * br, 0.0, 1.0));
  col += mix(col, vec3(1.0), 0.35) * fil * 0.9;
  col += vec3(rip);
  col *= 0.78 + 0.42 * br;

  float alpha = clamp(body * (0.85 + 0.2 * br) + core * 0.25, 0.0, 1.0);
  alpha = max(alpha, halo);
  // canvas 边界衰减窗：光晕在触边前归零，避免被裁出矩形边缘
  alpha *= smoothstep(0.5, 0.38, r);
  // premultiplied alpha：颜色必须先乘 alpha，否则透明区域仍会涂色（整块矩形）
  gl_FragColor = vec4(col * u_bright * alpha, alpha * u_bright);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile failed");
  }
  return sh;
}

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export class SoulOrb {
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private last = 0;
  private phase = 0;

  // 当前值与目标值（平滑滑移）
  private cur: Required<Omit<OrbParams, "css">> & { swirl: number; voice: number; wake: number } = {
    colA: paramsFor({ emotion: "calm", intensity: 0.3 }).colA,
    colB: paramsFor({ emotion: "calm", intensity: 0.3 }).colB,
    rate: 1.15,
    turb: 0.35,
    bright: 0.88,
    swirl: 0,
    voice: 0,
    wake: 0,
  };
  private target = { ...this.cur };

  private mood: Mood = { emotion: "calm", intensity: 0.3 };
  private state: OrbState = "idle";
  private reducedMotion = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) return;
    this.gl = gl;
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
      }
      this.prog = prog;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const name of [
        "u_res", "u_time", "u_phase", "u_colA", "u_colB",
        "u_turb", "u_bright", "u_swirl", "u_voice",
      ]) {
        this.uniforms[name] = gl.getUniformLocation(prog, name);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } catch (e) {
      console.warn("[soul] WebGL 初始化失败，使用 CSS 回退", e);
      this.gl = null;
    }
  }

  get webgl(): boolean {
    return this.gl !== null;
  }

  setMood(mood: Mood): void {
    this.mood = mood;
  }

  setState(state: OrbState): void {
    this.state = state;
  }

  /** 每收到一个文本增量时的"发声"脉冲。 */
  pulse(): void {
    this.target.voice = Math.min(1, this.target.voice + 0.45);
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl?.viewport(0, 0, w, h);
    }
  }

  private frame(t: number): void {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;

    // ── 计算目标参数 = 情绪基线 × 状态修饰 ──
    const p = paramsFor(this.mood);
    const tr = this.reducedMotion ? 0.4 : 1;
    const target = this.target;
    target.colA = p.colA;
    target.colB = p.colB;
    target.rate = p.rate * tr;
    target.turb = p.turb * (this.reducedMotion ? 0.5 : 1);
    target.bright = p.bright;
    target.swirl = 0;
    switch (this.state) {
      case "listening":
        target.bright += 0.12;
        target.rate *= 1.12;
        break;
      case "thinking":
        target.swirl = 1;
        target.turb += 0.28;
        target.bright *= 0.92;
        break;
      case "speaking":
        target.bright += 0.08;
        break;
      default:
        break;
    }

    // ── 平滑滑移 ──
    const k = 1 - Math.exp(-dt * 2.4);
    const c = this.cur;
    const lerp = (a: number, b: number) => a + (b - a) * k;
    for (let i = 0; i < 3; i++) {
      c.colA[i] = lerp(c.colA[i]!, target.colA[i]!);
      c.colB[i] = lerp(c.colB[i]!, target.colB[i]!);
    }
    c.rate = lerp(c.rate, target.rate);
    c.turb = lerp(c.turb, target.turb);
    c.bright = lerp(c.bright, target.bright);
    c.swirl = lerp(c.swirl, target.swirl);
    c.voice += (0 - c.voice) * (1 - Math.exp(-dt * 3.2));
    c.wake = lerp(c.wake, 1);

    // 呼吸相位积分（改频率时相位连续）
    this.phase += c.rate * dt * Math.PI * 2 * 0.18;

    const gl = this.gl;
    if (!gl || !this.prog) return;
    this.resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    const u = this.uniforms;
    gl.uniform2f(u.u_res!, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_time!, t / 1000);
    gl.uniform1f(u.u_phase!, this.phase);
    gl.uniform3f(u.u_colA!, c.colA[0]!, c.colA[1]!, c.colA[2]!);
    gl.uniform3f(u.u_colB!, c.colB[0]!, c.colB[1]!, c.colB[2]!);
    gl.uniform1f(u.u_turb!, c.turb);
    gl.uniform1f(u.u_bright!, c.bright * c.wake);
    gl.uniform1f(u.u_swirl!, c.swirl);
    gl.uniform1f(u.u_voice!, c.voice);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
