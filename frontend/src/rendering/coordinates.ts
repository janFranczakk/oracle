import type { Vec2 } from '../types';
export type Camera = { x: number; y: number; zoom: number };
export function scaleFor(width: number, height: number, zoom = 1) {
  return Math.min(width / 28, height / 17) * zoom;
}
export function worldToScreen(p: Vec2, camera: Camera, width: number, height: number): Vec2 {
  const scale = scaleFor(width, height, camera.zoom);
  return { x: width / 2 + (p.x - camera.x) * scale, y: height / 2 - (p.y - camera.y) * scale };
}
export function screenToWorld(p: Vec2, camera: Camera, width: number, height: number): Vec2 {
  const scale = scaleFor(width, height, camera.zoom);
  return { x: (p.x - width / 2) / scale + camera.x, y: (height / 2 - p.y) / scale + camera.y };
}
export function hitTest(
  p: Vec2,
  body: {
    position: Vec2;
    rotation: number;
    shape: string;
    radius: number;
    width: number;
    height: number;
  },
) {
  const dx = p.x - body.position.x,
    dy = p.y - body.position.y;
  if (body.shape === 'circle') return dx * dx + dy * dy <= body.radius * body.radius;
  const x = dx * Math.cos(body.rotation) + dy * Math.sin(body.rotation);
  const y = -dx * Math.sin(body.rotation) + dy * Math.cos(body.rotation);
  return Math.abs(x) <= body.width / 2 + 0.12 && Math.abs(y) <= body.height / 2 + 0.12;
}
